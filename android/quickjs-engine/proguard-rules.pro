# Same as consumer rules for library builds
-keepclasseswithmembernames class * {
    native <methods>;
}
-keep class com.jstorrent.quickjs.JsCallback { *; }
-keep class com.jstorrent.quickjs.QuickJsException { *; }
