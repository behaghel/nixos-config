#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <stdio.h>
#include <string.h>

// Password bytes arrive on stdin, never in argv, the environment, or a temp file.
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 4 || strcmp(argv[1], "write") != 0 || !argv[2][0] || !argv[3][0]) {
      fputs("usage: pass-keychain-write write <account> <service>\n", stderr);
      return 64;
    }

    NSMutableData *password = [NSMutableData data];
    unsigned char chunk[4096];
    size_t length;
    while ((length = fread(chunk, 1, sizeof(chunk), stdin)) != 0) {
      [password appendBytes:chunk length:length];
    }
    memset(chunk, 0, sizeof(chunk));
    if (ferror(stdin) || password.length == 0 ||
        memchr(password.bytes, '\0', password.length) != NULL) {
      fputs("pass-keychain-write: invalid password data\n", stderr);
      return 65;
    }

    NSString *account = [NSString stringWithUTF8String:argv[2]];
    NSString *service = [NSString stringWithUTF8String:argv[3]];
    if (account == nil || service == nil) {
      fputs("pass-keychain-write: invalid account or service\n", stderr);
      return 65;
    }
    NSDictionary *query = @{
      (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrAccount: account,
      (__bridge id)kSecAttrService: service,
    };
    NSDictionary *newValue = @{(__bridge id)kSecValueData: password};
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query,
                                    (__bridge CFDictionaryRef)newValue);
    if (status == errSecItemNotFound) {
      NSMutableDictionary *item = [query mutableCopy];
      item[(__bridge id)kSecValueData] = password;
      status = SecItemAdd((__bridge CFDictionaryRef)item, NULL);
      if (status == errSecDuplicateItem) {
        status = SecItemUpdate((__bridge CFDictionaryRef)query,
                               (__bridge CFDictionaryRef)newValue);
      }
    }
    if (status != errSecSuccess) {
      fprintf(stderr, "pass-keychain-write: Keychain error %d\n", (int)status);
      return 1;
    }
    return 0;
  }
}
