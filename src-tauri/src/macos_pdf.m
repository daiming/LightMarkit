#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

#include <dispatch/dispatch.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static const NSTimeInterval LightMarkitExportTimeout = 50.0;

static void lightmarkit_set_error(char **error_out, NSString *message) {
    if (!error_out) {
        return;
    }

    const char *utf8 = [message UTF8String];
    *error_out = utf8 ? strdup(utf8) : strdup("Unknown WebKit PDF export error");
}

@interface LightMarkitPDFExport : NSObject <WKNavigationDelegate>
@property(nonatomic, copy) NSString *pdfPath;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSPrintOperation *printOperation;
@property(nonatomic, copy) void (^completion)(BOOL success, NSString *message);
@property(nonatomic, strong) LightMarkitPDFExport *selfRetainer;
@property(nonatomic, assign) NSUInteger readinessChecks;
@property(nonatomic, assign) BOOL printing;
@property(nonatomic, assign) BOOL reported;
@end

@implementation LightMarkitPDFExport

- (void)startWithHTMLPath:(NSString *)htmlPath pdfPath:(NSString *)pdfPath {
    self.pdfPath = pdfPath;
    self.selfRetainer = self;

    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    self.webView = [[WKWebView alloc]
        initWithFrame:NSMakeRect(0, 0, 717, 1046)
        configuration:configuration];
    self.webView.navigationDelegate = self;

    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 717, 1046)
        styleMask:NSWindowStyleMaskBorderless
        backing:NSBackingStoreBuffered
        defer:NO];
    self.window.opaque = NO;
    self.window.hasShadow = NO;
    self.window.releasedWhenClosed = NO;
    self.window.ignoresMouseEvents = YES;
    self.window.alphaValue = 0.01;
    self.window.contentView = self.webView;

    // WKWebView must participate in a visible window hierarchy for AppKit printing
    // to complete layout. A nearly transparent borderless window avoids flashing UI.
    [self.window orderFrontRegardless];

    NSError *readError = nil;
    NSString *html = [NSString stringWithContentsOfFile:htmlPath
                                                encoding:NSUTF8StringEncoding
                                                   error:&readError];
    if (!html) {
        [self reportSuccess:NO
                    message:readError.localizedDescription ?: @"Safari WebKit failed to read the HTML document"
                    cleanup:YES];
        return;
    }

    NSURL *baseURL = [NSURL fileURLWithPath:[htmlPath stringByDeletingLastPathComponent]
                                isDirectory:YES];
    [self.webView loadHTMLString:html baseURL:baseURL];

    __weak LightMarkitPDFExport *weakSelf = self;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(LightMarkitExportTimeout * NSEC_PER_SEC)),
        dispatch_get_main_queue(),
        ^{
            LightMarkitPDFExport *strongSelf = weakSelf;
            if (!strongSelf || strongSelf.reported) {
                return;
            }

            // Do not release a WebKit view that an AppKit printing thread may still
            // reference. The print completion callback performs final cleanup later.
            [strongSelf reportSuccess:NO
                              message:@"Safari WebKit timed out while exporting the PDF"
                              cleanup:!strongSelf.printing];
        });
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    [self waitForPageReadiness];
}

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
             withError:(NSError *)error {
    [self reportSuccess:NO
                message:error.localizedDescription ?: @"Safari WebKit failed to load the document"
                cleanup:YES];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error {
    [self reportSuccess:NO
                message:error.localizedDescription ?: @"Safari WebKit failed to load the document"
                cleanup:YES];
}

- (void)waitForPageReadiness {
    if (self.reported) {
        return;
    }

    NSString *script =
        @"(() => {"
         "  const imagesReady = Array.from(document.images).every(image => image.complete);"
         "  const fontsReady = !document.fonts || document.fonts.status === 'loaded';"
         "  return imagesReady && fontsReady;"
         "})()";

    __weak LightMarkitPDFExport *weakSelf = self;
    [self.webView evaluateJavaScript:script
                   completionHandler:^(id result, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            LightMarkitPDFExport *strongSelf = weakSelf;
            if (!strongSelf || strongSelf.reported) {
                return;
            }
            if (error) {
                [strongSelf reportSuccess:NO
                                  message:error.localizedDescription ?: @"Safari WebKit failed to prepare the document"
                                  cleanup:YES];
                return;
            }

            BOOL ready = [result respondsToSelector:@selector(boolValue)] && [result boolValue];
            if (ready || strongSelf.readinessChecks++ >= 100) {
                // Give WebKit one final turn to commit image and font layout.
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                               dispatch_get_main_queue(), ^{
                    [strongSelf beginPrinting];
                });
                return;
            }

            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                           dispatch_get_main_queue(), ^{
                [strongSelf waitForPageReadiness];
            });
        });
    }];
}

- (void)beginPrinting {
    if (self.reported || self.printing) {
        return;
    }
    if (![self.webView respondsToSelector:@selector(printOperationWithPrintInfo:)]) {
        [self reportSuccess:NO
                    message:@"Native PDF export requires macOS 11 or later"
                    cleanup:YES];
        return;
    }

    NSPrintInfo *basePrintInfo = [[NSPrintInfo alloc] init];
    basePrintInfo.paperSize = NSMakeSize(8.27 * 72.0, 11.69 * 72.0);
    basePrintInfo.orientation = NSPaperOrientationPortrait;
    basePrintInfo.topMargin = 0.4 * 72.0;
    basePrintInfo.rightMargin = 0.4 * 72.0;
    basePrintInfo.bottomMargin = 0.4 * 72.0;
    basePrintInfo.leftMargin = 0.4 * 72.0;
    basePrintInfo.horizontalPagination = NSFitPagination;
    basePrintInfo.verticalPagination = NSAutoPagination;

    NSMutableDictionary *settings = [[basePrintInfo dictionary] mutableCopy];
    settings[NSPrintJobDisposition] = NSPrintSaveJob;
    settings[NSPrintJobSavingURL] = [NSURL fileURLWithPath:self.pdfPath];
    NSPrintInfo *printInfo = [[NSPrintInfo alloc] initWithDictionary:settings];

    self.printOperation = [self.webView printOperationWithPrintInfo:printInfo];
    if (!self.printOperation) {
        [self reportSuccess:NO
                    message:@"Safari WebKit could not create a print operation"
                    cleanup:YES];
        return;
    }

    self.printOperation.showsPrintPanel = NO;
    self.printOperation.showsProgressPanel = NO;
    self.printOperation.canSpawnSeparateThread = YES;
    self.printing = YES;

    // Unlike runOperation, this API permits AppKit to detach the actual printing
    // work, leaving the main event loop available for Tauri and WebKit callbacks.
    [self.printOperation
        runOperationModalForWindow:self.window
        delegate:self
        didRunSelector:@selector(printOperationDidRun:success:contextInfo:)
        contextInfo:NULL];
}

- (void)printOperationDidRun:(NSPrintOperation *)operation
                      success:(BOOL)success
                  contextInfo:(void *)contextInfo {
    dispatch_async(dispatch_get_main_queue(), ^{
        self.printing = NO;

        if (self.reported) {
            // Rust may already have removed the temporary file after a timeout.
            // Delete a file created by a late print completion as well.
            [[NSFileManager defaultManager] removeItemAtPath:self.pdfPath error:nil];
            [self reportSuccess:NO message:nil cleanup:YES];
            return;
        }

        NSDictionary *attributes = [[NSFileManager defaultManager]
            attributesOfItemAtPath:self.pdfPath
            error:nil];
        NSNumber *fileSize = attributes[NSFileSize];
        BOOL hasPDF = fileSize.unsignedLongLongValue > 0;
        BOOL completed = success && hasPDF;
        NSString *message = nil;
        if (!completed) {
            message = success
                ? @"Safari WebKit print did not produce the PDF file"
                : @"Safari WebKit failed to generate the PDF file";
        }
        [self reportSuccess:completed message:message cleanup:YES];
    });
}

- (void)reportSuccess:(BOOL)success
               message:(NSString *)message
               cleanup:(BOOL)cleanup {
    if (!self.reported) {
        self.reported = YES;
        if (self.completion) {
            self.completion(success, message);
        }
    }

    if (cleanup) {
        [self.window orderOut:nil];
        self.webView.navigationDelegate = nil;
        self.printOperation = nil;
        self.webView = nil;
        self.window = nil;
        self.completion = nil;
        self.selfRetainer = nil;
    }
}

@end

bool lightmarkit_webkit_create_pdf(
    const char *html_path,
    const char *pdf_path,
    char **error_out
) {
    NSString *htmlPath = html_path ? [NSString stringWithUTF8String:html_path] : nil;
    NSString *pdfPath = pdf_path ? [NSString stringWithUTF8String:pdf_path] : nil;
    if (!htmlPath || !pdfPath) {
        lightmarkit_set_error(error_out, @"Invalid HTML or PDF path");
        return false;
    }

    __block BOOL success = NO;
    __block NSString *errorMessage = nil;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);

    dispatch_async(dispatch_get_main_queue(), ^{
        LightMarkitPDFExport *exporter = [LightMarkitPDFExport new];
        exporter.completion = ^(BOOL completed, NSString *message) {
            success = completed;
            errorMessage = message;
            dispatch_semaphore_signal(done);
        };
        [exporter startWithHTMLPath:htmlPath pdfPath:pdfPath];
    });

    NSTimeInterval waitSeconds = LightMarkitExportTimeout + 5.0;
    if ([NSThread isMainThread]) {
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:waitSeconds];
        while (dispatch_semaphore_wait(done, DISPATCH_TIME_NOW) != 0 &&
               [deadline timeIntervalSinceNow] > 0) {
            [[NSRunLoop currentRunLoop]
                runMode:NSRunLoopCommonModes
                beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        }
        if ([deadline timeIntervalSinceNow] <= 0 && !success && !errorMessage) {
            errorMessage = @"Safari WebKit timed out while exporting the PDF";
        }
    } else if (dispatch_semaphore_wait(
                   done,
                   dispatch_time(DISPATCH_TIME_NOW, (int64_t)(waitSeconds * NSEC_PER_SEC))) != 0) {
        errorMessage = @"Safari WebKit timed out while exporting the PDF";
    }

    if (!success) {
        lightmarkit_set_error(
            error_out,
            errorMessage ?: @"Safari WebKit PDF export failed");
    }
    return success;
}

void lightmarkit_free_error(char *error) {
    free(error);
}
