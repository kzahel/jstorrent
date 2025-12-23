# Keep JNI methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep callback class
-keep class com.jstorrent.quickjs.JsCallback { *; }
-keep class com.jstorrent.quickjs.QuickJsException { *; }
