#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

// Query the opener for a real file: a UTI-level lookup can disagree with Finder.
static BOOL opensWith(NSWorkspace *workspace, NSURL *file, NSString *bundleID) {
  NSURL *current = [workspace URLForApplicationToOpenURL:file];
  return current && [[[NSBundle bundleWithURL:current] bundleIdentifier] isEqualToString:bundleID];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 4) {
      fprintf(stderr, "usage: set-default-file-association UTI APP_PATH EXTENSION\n");
      return 2;
    }
    NSString *identifier = [NSString stringWithUTF8String:argv[1]];
    NSString *appPath = [NSString stringWithUTF8String:argv[2]];
    NSString *extension = [NSString stringWithUTF8String:argv[3]];
    UTType *type = [UTType typeWithIdentifier:identifier];
    NSURL *app = [NSURL fileURLWithPath:appPath isDirectory:YES];
    NSString *bundleID = [[NSBundle bundleWithURL:app] bundleIdentifier];
    if (!type || !bundleID || extension.length == 0 ||
        ![[NSFileManager defaultManager] fileExistsAtPath:appPath]) {
      fprintf(stderr, "Invalid file type or application bundle\n");
      return 2;
    }

    NSString *name = [NSString stringWithFormat:@"file-association-%@.%@",
                      [[NSUUID UUID] UUIDString], extension];
    NSURL *sample = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:name]];
    NSFileManager *files = [NSFileManager defaultManager];
    if (![files createFileAtPath:sample.path contents:[NSData data] attributes:nil]) {
      fprintf(stderr, "Cannot create a sample file to check the effective opener\n");
      return 1;
    }

    int result = 0;
    @try {
      NSWorkspace *workspace = [NSWorkspace sharedWorkspace];
      if (!opensWith(workspace, sample, bundleID)) {
        fprintf(stderr, "Requesting macOS approval for %s → %s\n", argv[1], argv[2]);
        __block BOOL finished = NO;
        __block BOOL failed = NO;
        [workspace setDefaultApplicationAtURL:app
                            toOpenContentType:type
                             completionHandler:^(NSError *error) {
          if (error) {
            NSLog(@"Default application request failed: %@", error);
            failed = YES;
          }
          finished = YES;
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:120];
        while (!finished && [deadline timeIntervalSinceNow] > 0) {
          [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                                   beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        }
        if (!finished) {
          fprintf(stderr, "Timed out waiting for the macOS default-app request\n");
          result = 1;
        } else if (failed) {
          fprintf(stderr, "macOS rejected the default-app request\n");
          result = 1;
        } else if (!opensWith(workspace, sample, bundleID)) {
          NSURL *selected = [workspace URLForApplicationToOpenURL:sample];
          fprintf(stderr, "macOS still selects %s for .%s; check the app's document-type declaration\n",
                  selected ? selected.fileSystemRepresentation : "no app", argv[3]);
          result = 1;
        }
      }
    } @finally {
      [files removeItemAtURL:sample error:nil];
    }
    return result;
  }
}
