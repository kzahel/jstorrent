-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }

# JNA ships no consumer rules. Its native dispatcher resolves JNA classes and
# members by name, and UniFFI's generated bindings rely on JNA reflection:
# Structure fields are matched against @Structure.FieldOrder names, ByValue
# structures are instantiated reflectively, and Callback methods are invoked
# from native code. The `external fun` FFI declarations are native methods,
# which the default rules already keep.
-dontwarn java.awt.**
-keep class com.sun.jna.** { *; }
-keep class * extends com.sun.jna.Structure { *; }
-keep interface * extends com.sun.jna.Callback { *; }
-keep class * implements com.sun.jna.Callback { *; }
