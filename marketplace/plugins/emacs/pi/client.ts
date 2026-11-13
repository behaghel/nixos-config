// Transport only. No Pi imports, server startup, credentials, logs or retries.
export type Exec = (command: string, args: string[], options: {
  signal?: AbortSignal; timeout: number; maxBuffer: number;
}) => Promise<{ code: number; stdout: string; stderr: string; killed?: boolean; truncated?: boolean }>;

export interface Options {
  socket?: string;
  buffer?: string;
  timeoutMs?: number;
  preserveContext?: boolean;
}
export interface Evaluation extends Options { expression: string }
export interface Result {
  status: "ok" | "error" | "not-executed" | "unknown";
  mayHaveEffects: boolean;
  message?: string;
  errorKind?: string;
  value?: string;
  truncated?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

export const notExecuted = (message: string): Result => ({
  status: "not-executed", mayHaveEffects: false, message,
});

function validate(options: Options, expression?: string): string | undefined {
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs)
    || options.timeoutMs < 100 || options.timeoutMs > 30000)) return "timeoutMs must be 100–30000.";
  for (const value of [options.socket, options.buffer]) {
    if (value !== undefined && (typeof value !== "string" || !value.length || value.includes("\0"))) {
      return "Socket and buffer names must be nonempty strings without NUL characters.";
    }
  }
  if (options.preserveContext !== undefined && typeof options.preserveContext !== "boolean") {
    return "preserveContext must be boolean.";
  }
  if (expression !== undefined && (typeof expression !== "string" || !expression.trim()
    || expression.length > 8192)) return "Provide one Elisp expression, at most 8192 characters.";
}

function program(kind: "status" | "eval", options: Options, expression?: string): string {
  const target = options.buffer
    ? `(or (get-buffer ${JSON.stringify(options.buffer)}) (error "Missing target buffer"))`
    : "(window-buffer (selected-window))";
  const operation = kind === "status" ? `
    \`((ok . t) (metadata . ((version . ,emacs-version) (pid . ,(emacs-pid))
      (configDirectory . ,user-emacs-directory) (buffer . ,(buffer-name))
      (majorMode . ,(symbol-name major-mode)) (point . ,(point))
      (modified . ,(if (buffer-modified-p) t :json-false))
      (readOnly . ,(if buffer-read-only t :json-false))
      (minibufferActive . ,(if (active-minibuffer-window) t :json-false)))))`
    : `(let* ((pi-emacs--source ${JSON.stringify(expression)})
              (pi-emacs--parsed (read-from-string pi-emacs--source)))
         (unless (string-empty-p
                  (string-trim (substring pi-emacs--source (cdr pi-emacs--parsed))))
           (error "Provide one expression; wrap multiple forms in progn"))
         (let* ((pi-emacs--value (eval (car pi-emacs--parsed) t))
                (pi-emacs--printed (prin1-to-string pi-emacs--value))
                (pi-emacs--cut (> (length pi-emacs--printed) 4096)))
           \`((ok . t) (value . ,(substring pi-emacs--printed 0
                                          (min 4096 (length pi-emacs--printed))))
             (truncated . ,(if pi-emacs--cut t :json-false)))))`;
  const body = `(with-current-buffer ${target} ${operation})`;
  const guarded = options.preserveContext === false ? body
    : `(save-window-excursion (save-excursion
         (with-current-buffer ${target} (save-excursion ${operation}))))`;
  // emacsclient can octal-escape non-ASCII bytes in printed Lisp strings.
  // An ASCII-only base64 envelope avoids treating Lisp escaping as JSON escaping.
  return `(progn (require 'json) (require 'subr-x)
    (let ((print-length 32) (print-level 6) (print-circle t)
          (print-escape-newlines t) (print-escape-control-characters t))
      (base64-encode-string
       (encode-coding-string
        (json-serialize
         (condition-case pi-emacs--error ${guarded}
           (error \`((ok . :json-false)
                     (errorKind . ,(symbol-name (car pi-emacs--error))))))
         :false-object :json-false :null-object nil)
        'utf-8-unix) t)))`;
}

export function createEmacsBridge(exec: Exec) {
  async function run(kind: "status" | "eval", options: Options, expression?: string,
    signal?: AbortSignal): Promise<Result> {
    if (kind === "eval" && typeof expression !== "string") return notExecuted("An expression is required.");
    const invalid = validate(options, expression);
    if (invalid) return notExecuted(invalid);
    if (signal?.aborted) return notExecuted("Cancelled before client execution.");
    const mayHaveEffects = kind === "eval";
    const unknown = (): Result => ({ status: "unknown", mayHaveEffects,
      message: "No confirmed Emacs response. Check emacsclient/server availability. Execution may have occurred or may still be running; do not automatically retry." });
    try {
      const args = ["--alternate-editor=false"];
      if (options.socket) args.push(`--socket-name=${options.socket}`);
      args.push("--eval", program(kind, options, expression));
      const response = await exec("emacsclient", args, {
        timeout: options.timeoutMs ?? 5000, maxBuffer: 65536, signal,
      });
      if (response.killed || response.truncated || response.code !== 0) return unknown();
      const encoded = JSON.parse(response.stdout.trim());
      if (typeof encoded !== "string" || encoded.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return unknown();
      const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      if (!payload || typeof payload.ok !== "boolean") return unknown();
      if (!payload.ok) return { status: "error", mayHaveEffects,
        errorKind: typeof payload.errorKind === "string" && /^[a-zA-Z0-9-]+$/.test(payload.errorKind)
          ? payload.errorKind : "elisp-error",
        message: "Elisp failed; prior effects were not rolled back. Error data is withheld." };
      if (kind === "eval") {
        if (typeof payload.value !== "string") return unknown();
        return { status: "ok", mayHaveEffects, value: payload.value.slice(0, 4096),
          truncated: payload.truncated === true || payload.value.length > 4096 };
      }
      if (!payload.metadata || typeof payload.metadata !== "object") return unknown();
      const metadata: Record<string, string | number | boolean> = {};
      for (const key of ["version", "pid", "configDirectory", "buffer", "majorMode", "point",
        "modified", "readOnly", "minibufferActive"]) {
        const value = payload.metadata[key];
        if (["string", "number", "boolean"].includes(typeof value)) {
          metadata[key] = typeof value === "string" ? value.slice(0, 1024) : value;
        }
      }
      return { status: "ok", mayHaveEffects: false, metadata };
    } catch {
      // Do not expose stderr, arbitrary error objects, credentials, or partial responses.
      return unknown();
    }
  }
  return {
    status: (options: Options = {}, signal?: AbortSignal) => run("status", options, undefined, signal),
    evaluate: (options: Evaluation, signal?: AbortSignal) => run("eval", options, options.expression, signal),
  };
}
