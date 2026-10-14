#import <Cocoa/Cocoa.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <errno.h>
#include <unistd.h>
#include <ifaddrs.h>
#ifndef PROBE_ID
#define PROBE_ID "undefined"
#endif
@interface Probe : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTextField *status;
@property NSMutableArray *events;
@property NSMutableArray *descriptors;
@end
@implementation Probe
- (void)record:(NSString *)operation result:(int)result error:(int)error {
    NSDictionary *event=@{@"operation":operation,@"result":@(result),@"errno":@(error),@"error":error ? [NSString stringWithUTF8String:strerror(error)] : @"",@"time":@([[NSDate date] timeIntervalSince1970])};
    [self.events addObject:event];
    self.status.stringValue=[NSString stringWithFormat:@"%@: result=%d errno=%d",operation,result,error];
    NSString *out=[[NSBundle mainBundle] objectForInfoDictionaryKey:@"ProbeResults"];
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"probe":@PROBE_ID,@"events":self.events} options:NSJSONWritingPrettyPrinted error:nil];
    [data writeToFile:out atomically:YES];
}
- (void)interfaces {
    struct ifaddrs *items=NULL;int result=getifaddrs(&items);int error=result<0?errno:0;int count=0;if(result==0){for(struct ifaddrs *item=items;item;item=item->ifa_next)if(item->ifa_addr)count++;freeifaddrs(items);}[self record:@"getifaddrs_no_network" result:result<0?-1:count error:error];
}
- (int)udp {
    int fd=socket(AF_INET,SOCK_DGRAM,0);
    struct sockaddr_in local={0}; local.sin_len=sizeof(local); local.sin_family=AF_INET;
    if(fd<0 || bind(fd,(struct sockaddr*)&local,sizeof(local))<0) {int error=errno;if(fd>=0)close(fd);[self record:@"udp_bind_failed" result:-1 error:error];return -1;}
    [self.descriptors addObject:@(fd)];return fd;
}
- (void)connectAddress:(NSString *)ip operation:(NSString *)operation {
    int fd=[self udp];if(fd<0)return;
    struct sockaddr_in remote={0};remote.sin_len=sizeof(remote);remote.sin_family=AF_INET;remote.sin_port=htons(1900);inet_pton(AF_INET,ip.UTF8String,&remote.sin_addr);
    int result=connect(fd,(struct sockaddr*)&remote,sizeof(remote));int error=result<0?errno:0;
    [self record:operation result:result error:error];
}
- (void)incoming:(id)sender {
    int udp=[self udp];[self record:@"udp_bind_wildcard" result:udp>=0?0:-1 error:0];
    int fd=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in address={0};address.sin_len=sizeof(address);address.sin_family=AF_INET;
    int result=fd<0?-1:bind(fd,(struct sockaddr*)&address,sizeof(address));if(result==0)result=listen(fd,4);int error=result<0?errno:0;
    if(fd>=0)[self.descriptors addObject:@(fd)];[self record:@"tcp_listen_wildcard" result:result error:error];
}
- (void)publicRoute:(id)sender { [self connectAddress:@"198.51.100.1" operation:@"udp_connect_public_route_no_send"]; }
- (void)multicast:(id)sender { [self connectAddress:@"239.255.255.250" operation:@"udp_connect_multicast_no_send"]; }
- (void)quit:(id)sender { [NSApp terminate:nil]; }
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.events=[NSMutableArray array];self.descriptors=[NSMutableArray array];
    self.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(120,120,550,240) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    self.window.title=[[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleDisplayName"];
    self.status=[NSTextField labelWithString:@"Ready; no local-network operation yet"];
    self.status.frame=NSMakeRect(20,190,510,30);[self.window.contentView addSubview:self.status];
    NSArray *labels=@[@"Bind incoming sockets",@"Probe public route",@"Enable local-network probe",@"Quit probe"];
    NSArray *selectors=@[NSStringFromSelector(@selector(incoming:)),NSStringFromSelector(@selector(publicRoute:)),NSStringFromSelector(@selector(multicast:)),NSStringFromSelector(@selector(quit:))];
    for(NSUInteger i=0;i<labels.count;i++) {NSButton *button=[NSButton buttonWithTitle:labels[i] target:self action:NSSelectorFromString(selectors[i])];button.frame=NSMakeRect(20,145-i*38,300,32);[self.window.contentView addSubview:button];}
    [self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];[self record:@"launch_no_network" result:0 error:0];
    if([[[NSBundle mainBundle] objectForInfoDictionaryKey:@"ProbeAutomaticInterfaces"] boolValue]) [self interfaces];
    if([[[NSBundle mainBundle] objectForInfoDictionaryKey:@"ProbeAutomaticMulticast"] boolValue]) [self multicast:nil];
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    for(NSNumber *fd in self.descriptors)close(fd.intValue);[self record:@"quit_closed_sockets" result:0 error:0];return NSTerminateNow;
}
@end
int main(void) { @autoreleasepool { NSApplication *app=[NSApplication sharedApplication];[app setActivationPolicy:NSApplicationActivationPolicyRegular];Probe *delegate=[Probe new];app.delegate=delegate;[app run]; }return 0; }
