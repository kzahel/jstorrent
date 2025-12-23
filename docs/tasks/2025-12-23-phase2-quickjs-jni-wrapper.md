# Phase 2: Build QuickJS JNI Wrapper

**Status:** Ready  
**Goal:** Create a custom JNI wrapper around quickjs-ng for Android

---

## Overview

We're building our own JNI wrapper around quickjs-ng. This gives us:
- Full control, no third-party Kotlin/Java wrapper dependency
- quickjs-ng upstream is actively maintained (the C library)
- Small surface area - we only need what we actually use

**Total surface area needed:**
- `create()` / `close()` - lifecycle
- `evaluate(script): Any?` - run JS code
- `setGlobalFunction(name, callback)` - register Kotlin callbacks
- `getGlobalObject()` / property access - for more complex bindings

---

## Module Structure

```
android/quickjs-engine/
├── build.gradle.kts
├── consumer-rules.pro
├── proguard-rules.pro
├── src/
│   ├── main/
│   │   ├── kotlin/com/jstorrent/quickjs/
│   │   │   ├── QuickJsContext.kt      # Kotlin API
│   │   │   ├── QuickJsException.kt    # Exception type
│   │   │   └── JsValue.kt             # Value wrapper (optional)
│   │   └── cpp/
│   │       ├── CMakeLists.txt
│   │       ├── quickjs-jni.c          # JNI bridge code
│   │       └── quickjs-ng/            # git submodule
│   └── test/
│       └── kotlin/com/jstorrent/quickjs/
│           └── QuickJsContextTest.kt
└── CMakeLists.txt                      # Top-level CMake
```

---

## Step 1: Create Module Directory Structure

```bash
mkdir -p android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs
mkdir -p android/quickjs-engine/src/main/cpp
mkdir -p android/quickjs-engine/src/test/kotlin/com/jstorrent/quickjs
```

---

## Step 2: Add quickjs-ng as Submodule

From the `android/quickjs-engine/src/main/cpp` directory:

```bash
cd android/quickjs-engine/src/main/cpp
git submodule add https://github.com/quickjs-ng/quickjs.git quickjs-ng
```

Or if you prefer vendoring, download a release tarball instead.

---

## Step 3: Create build.gradle.kts

Create `android/quickjs-engine/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.jstorrent.quickjs"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
        
        ndk {
            // Build for these ABIs
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
        
        externalNativeBuild {
            cmake {
                arguments += listOf(
                    "-DANDROID_STL=c++_shared"
                )
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
    
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions {
        jvmTarget = "11"
    }
}

dependencies {
    implementation(libs.kotlinx.coroutines.android)
    
    testImplementation(libs.junit)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
```

---

## Step 4: Create CMakeLists.txt

Create `android/quickjs-engine/src/main/cpp/CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.22.1)
project(quickjs-jni)

# QuickJS-ng source files (minimal set needed)
set(QUICKJS_SRC
    quickjs-ng/quickjs.c
    quickjs-ng/libregexp.c
    quickjs-ng/libunicode.c
    quickjs-ng/cutils.c
    quickjs-ng/libbf.c
)

# Our JNI bridge
set(JNI_SRC
    quickjs-jni.c
)

# Build as shared library
add_library(quickjs-jni SHARED
    ${QUICKJS_SRC}
    ${JNI_SRC}
)

# Include directories
target_include_directories(quickjs-jni PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/quickjs-ng
)

# Compiler flags for QuickJS
target_compile_definitions(quickjs-jni PRIVATE
    CONFIG_VERSION="0.8.0"
    CONFIG_BIGNUM=1
    _GNU_SOURCE=1
)

# Link against Android log library (for __android_log_print)
find_library(log-lib log)
target_link_libraries(quickjs-jni ${log-lib})

# Optimization flags
target_compile_options(quickjs-jni PRIVATE
    -O2
    -fvisibility=hidden
    -fPIC
)
```

---

## Step 5: Create JNI Bridge (C)

Create `android/quickjs-engine/src/main/cpp/quickjs-jni.c`:

```c
#include <jni.h>
#include <android/log.h>
#include <string.h>
#include <stdlib.h>
#include "quickjs.h"

#define LOG_TAG "QuickJS-JNI"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

// -----------------------------------------------------------------------------
// Helper: Convert JS value to Java object
// -----------------------------------------------------------------------------
static jobject js_value_to_jobject(JNIEnv *env, JSContext *ctx, JSValue val) {
    if (JS_IsNull(val) || JS_IsUndefined(val)) {
        return NULL;
    }
    
    if (JS_IsBool(val)) {
        jclass cls = (*env)->FindClass(env, "java/lang/Boolean");
        jmethodID mid = (*env)->GetStaticMethodID(env, cls, "valueOf", "(Z)Ljava/lang/Boolean;");
        return (*env)->CallStaticObjectMethod(env, cls, mid, JS_ToBool(ctx, val) ? JNI_TRUE : JNI_FALSE);
    }
    
    if (JS_IsNumber(val)) {
        double d;
        JS_ToFloat64(ctx, &d, val);
        
        // Check if it's an integer
        if (d == (int64_t)d && d >= -2147483648.0 && d <= 2147483647.0) {
            jclass cls = (*env)->FindClass(env, "java/lang/Integer");
            jmethodID mid = (*env)->GetStaticMethodID(env, cls, "valueOf", "(I)Ljava/lang/Integer;");
            return (*env)->CallStaticObjectMethod(env, cls, mid, (jint)d);
        } else {
            jclass cls = (*env)->FindClass(env, "java/lang/Double");
            jmethodID mid = (*env)->GetStaticMethodID(env, cls, "valueOf", "(D)Ljava/lang/Double;");
            return (*env)->CallStaticObjectMethod(env, cls, mid, d);
        }
    }
    
    if (JS_IsString(val)) {
        const char *str = JS_ToCString(ctx, val);
        jstring jstr = (*env)->NewStringUTF(env, str);
        JS_FreeCString(ctx, str);
        return jstr;
    }
    
    // For objects/arrays, return string representation for now
    // Can be extended to return JSObject wrapper
    const char *str = JS_ToCString(ctx, val);
    if (str) {
        jstring jstr = (*env)->NewStringUTF(env, str);
        JS_FreeCString(ctx, str);
        return jstr;
    }
    
    return NULL;
}

// -----------------------------------------------------------------------------
// Helper: Throw Java exception from JS exception
// -----------------------------------------------------------------------------
static void throw_js_exception(JNIEnv *env, JSContext *ctx) {
    JSValue exception = JS_GetException(ctx);
    const char *msg = JS_ToCString(ctx, exception);
    
    jclass cls = (*env)->FindClass(env, "com/jstorrent/quickjs/QuickJsException");
    (*env)->ThrowNew(env, cls, msg ? msg : "Unknown JavaScript error");
    
    if (msg) JS_FreeCString(ctx, msg);
    JS_FreeValue(ctx, exception);
}

// -----------------------------------------------------------------------------
// JNI: Create runtime and context
// Returns: long (pointer to JSContext)
// -----------------------------------------------------------------------------
JNIEXPORT jlong JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeCreate(JNIEnv *env, jclass clazz) {
    JSRuntime *rt = JS_NewRuntime();
    if (!rt) {
        jclass cls = (*env)->FindClass(env, "com/jstorrent/quickjs/QuickJsException");
        (*env)->ThrowNew(env, cls, "Failed to create QuickJS runtime");
        return 0;
    }
    
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) {
        JS_FreeRuntime(rt);
        jclass cls = (*env)->FindClass(env, "com/jstorrent/quickjs/QuickJsException");
        (*env)->ThrowNew(env, cls, "Failed to create QuickJS context");
        return 0;
    }
    
    // Enable BigNum extension
    JS_AddIntrinsicBigFloat(ctx);
    JS_AddIntrinsicBigDecimal(ctx);
    
    LOGD("QuickJS context created: %p", ctx);
    return (jlong)(intptr_t)ctx;
}

// -----------------------------------------------------------------------------
// JNI: Destroy runtime and context
// -----------------------------------------------------------------------------
JNIEXPORT void JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeDestroy(JNIEnv *env, jclass clazz, jlong ctxPtr) {
    JSContext *ctx = (JSContext *)(intptr_t)ctxPtr;
    if (ctx) {
        JSRuntime *rt = JS_GetRuntime(ctx);
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        LOGD("QuickJS context destroyed: %p", ctx);
    }
}

// -----------------------------------------------------------------------------
// JNI: Evaluate JavaScript code
// Returns: Object (boxed primitive, String, or null)
// -----------------------------------------------------------------------------
JNIEXPORT jobject JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeEvaluate(
    JNIEnv *env, 
    jclass clazz, 
    jlong ctxPtr, 
    jstring script, 
    jstring filename
) {
    JSContext *ctx = (JSContext *)(intptr_t)ctxPtr;
    
    const char *scriptStr = (*env)->GetStringUTFChars(env, script, NULL);
    const char *filenameStr = (*env)->GetStringUTFChars(env, filename, NULL);
    
    JSValue result = JS_Eval(ctx, scriptStr, strlen(scriptStr), filenameStr, JS_EVAL_TYPE_GLOBAL);
    
    (*env)->ReleaseStringUTFChars(env, script, scriptStr);
    (*env)->ReleaseStringUTFChars(env, filename, filenameStr);
    
    if (JS_IsException(result)) {
        throw_js_exception(env, ctx);
        return NULL;
    }
    
    jobject jresult = js_value_to_jobject(env, ctx, result);
    JS_FreeValue(ctx, result);
    
    return jresult;
}

// -----------------------------------------------------------------------------
// Callback storage structure
// -----------------------------------------------------------------------------
typedef struct {
    JavaVM *jvm;
    jobject callback;      // Global ref to Kotlin callback
    jmethodID invokeMethod;
} JsCallbackData;

// -----------------------------------------------------------------------------
// JS function that calls back to Kotlin
// -----------------------------------------------------------------------------
static JSValue js_kotlin_callback(
    JSContext *ctx, 
    JSValueConst this_val,
    int argc, 
    JSValueConst *argv,
    int magic,
    JSValue *func_data
) {
    JsCallbackData *data = (JsCallbackData *)JS_GetOpaque(*func_data, 1);
    if (!data) {
        return JS_ThrowInternalError(ctx, "Callback data not found");
    }
    
    JNIEnv *env;
    int attached = 0;
    
    // Get JNIEnv for current thread
    jint status = (*data->jvm)->GetEnv(data->jvm, (void **)&env, JNI_VERSION_1_6);
    if (status == JNI_EDETACHED) {
        (*data->jvm)->AttachCurrentThread(data->jvm, &env, NULL);
        attached = 1;
    }
    
    // Convert JS args to Java String array
    jclass stringClass = (*env)->FindClass(env, "java/lang/String");
    jobjectArray jargs = (*env)->NewObjectArray(env, argc, stringClass, NULL);
    
    for (int i = 0; i < argc; i++) {
        const char *str = JS_ToCString(ctx, argv[i]);
        if (str) {
            jstring jstr = (*env)->NewStringUTF(env, str);
            (*env)->SetObjectArrayElement(env, jargs, i, jstr);
            (*env)->DeleteLocalRef(env, jstr);
            JS_FreeCString(ctx, str);
        }
    }
    
    // Call Kotlin callback: invoke(args: Array<String>): String?
    jstring jresult = (jstring)(*env)->CallObjectMethod(env, data->callback, data->invokeMethod, jargs);
    
    (*env)->DeleteLocalRef(env, jargs);
    
    JSValue result = JS_UNDEFINED;
    if (jresult) {
        const char *resultStr = (*env)->GetStringUTFChars(env, jresult, NULL);
        result = JS_NewString(ctx, resultStr);
        (*env)->ReleaseStringUTFChars(env, jresult, resultStr);
        (*env)->DeleteLocalRef(env, jresult);
    }
    
    if (attached) {
        (*data->jvm)->DetachCurrentThread(data->jvm);
    }
    
    return result;
}

// -----------------------------------------------------------------------------
// Destructor for callback data
// -----------------------------------------------------------------------------
static void js_callback_finalizer(JSRuntime *rt, JSValue val) {
    JsCallbackData *data = (JsCallbackData *)JS_GetOpaque(val, 1);
    if (data) {
        JNIEnv *env;
        (*data->jvm)->GetEnv(data->jvm, (void **)&env, JNI_VERSION_1_6);
        if (env) {
            (*env)->DeleteGlobalRef(env, data->callback);
        }
        free(data);
    }
}

// -----------------------------------------------------------------------------
// JNI: Set a global function that calls back to Kotlin
// -----------------------------------------------------------------------------
JNIEXPORT void JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeSetGlobalFunction(
    JNIEnv *env,
    jclass clazz,
    jlong ctxPtr,
    jstring name,
    jobject callback
) {
    JSContext *ctx = (JSContext *)(intptr_t)ctxPtr;
    
    // Get JavaVM reference
    JavaVM *jvm;
    (*env)->GetJavaVM(env, &jvm);
    
    // Create callback data
    JsCallbackData *data = malloc(sizeof(JsCallbackData));
    data->jvm = jvm;
    data->callback = (*env)->NewGlobalRef(env, callback);
    
    // Get invoke method
    jclass callbackClass = (*env)->GetObjectClass(env, callback);
    data->invokeMethod = (*env)->GetMethodID(env, callbackClass, "invoke", "([Ljava/lang/String;)Ljava/lang/String;");
    
    // Create opaque JSValue to hold callback data
    JSValue funcData = JS_NewObjectClass(ctx, 1);  // Class ID 1 for our callbacks
    JS_SetOpaque(funcData, data);
    
    // Create JS function with callback
    JSValue func = JS_NewCFunctionData(ctx, js_kotlin_callback, 0, 0, 1, &funcData);
    
    // Set on global object
    const char *nameStr = (*env)->GetStringUTFChars(env, name, NULL);
    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, nameStr, func);
    JS_FreeValue(ctx, global);
    
    (*env)->ReleaseStringUTFChars(env, name, nameStr);
    
    LOGD("Registered global function: %s", nameStr);
}

// -----------------------------------------------------------------------------
// JNI: Execute pending jobs (for promises)
// Returns: true if there are more jobs pending
// -----------------------------------------------------------------------------
JNIEXPORT jboolean JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeExecutePendingJob(JNIEnv *env, jclass clazz, jlong ctxPtr) {
    JSContext *ctx = (JSContext *)(intptr_t)ctxPtr;
    JSContext *ctx2;
    int ret = JS_ExecutePendingJob(JS_GetRuntime(ctx), &ctx2);
    return ret > 0 ? JNI_TRUE : JNI_FALSE;
}
```

---

## Step 6: Create Kotlin API

Create `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/QuickJsException.kt`:

```kotlin
package com.jstorrent.quickjs

class QuickJsException(message: String) : RuntimeException(message)
```

Create `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/QuickJsContext.kt`:

```kotlin
package com.jstorrent.quickjs

import androidx.annotation.Keep
import java.io.Closeable

/**
 * A QuickJS JavaScript runtime context.
 * 
 * Thread-safety: QuickJS is single-threaded. All calls to a context
 * must happen on the same thread that created it.
 */
class QuickJsContext private constructor(
    private var contextPtr: Long
) : Closeable {
    
    companion object {
        init {
            System.loadLibrary("quickjs-jni")
        }
        
        /**
         * Create a new QuickJS context.
         */
        fun create(): QuickJsContext {
            val ptr = nativeCreate()
            if (ptr == 0L) {
                throw QuickJsException("Failed to create QuickJS context")
            }
            return QuickJsContext(ptr)
        }
        
        @JvmStatic
        private external fun nativeCreate(): Long
        
        @JvmStatic
        private external fun nativeDestroy(ctxPtr: Long)
        
        @JvmStatic
        private external fun nativeEvaluate(ctxPtr: Long, script: String, filename: String): Any?
        
        @JvmStatic
        private external fun nativeSetGlobalFunction(ctxPtr: Long, name: String, callback: JsCallback)
        
        @JvmStatic
        private external fun nativeExecutePendingJob(ctxPtr: Long): Boolean
    }
    
    /**
     * Evaluate JavaScript code.
     * 
     * @param script The JavaScript code to evaluate
     * @param filename Optional filename for error messages
     * @return The result (Boolean, Int, Double, String, or null)
     */
    fun evaluate(script: String, filename: String = "script.js"): Any? {
        checkNotClosed()
        return nativeEvaluate(contextPtr, script, filename)
    }
    
    /**
     * Evaluate JavaScript and cast result to expected type.
     */
    inline fun <reified T> evaluateTyped(script: String, filename: String = "script.js"): T {
        return evaluate(script, filename) as T
    }
    
    /**
     * Register a global function that calls back to Kotlin.
     * 
     * @param name The function name in JavaScript
     * @param callback The Kotlin callback to invoke
     */
    fun setGlobalFunction(name: String, callback: (Array<String>) -> String?) {
        checkNotClosed()
        nativeSetGlobalFunction(contextPtr, name, JsCallback(callback))
    }
    
    /**
     * Execute pending jobs (promises, etc).
     * 
     * @return true if there are more jobs pending
     */
    fun executePendingJob(): Boolean {
        checkNotClosed()
        return nativeExecutePendingJob(contextPtr)
    }
    
    /**
     * Execute all pending jobs.
     */
    fun executeAllPendingJobs() {
        while (executePendingJob()) {
            // Keep executing until no more jobs
        }
    }
    
    /**
     * Check if context is still open.
     */
    fun isClosed(): Boolean = contextPtr == 0L
    
    private fun checkNotClosed() {
        if (contextPtr == 0L) {
            throw IllegalStateException("QuickJsContext is closed")
        }
    }
    
    /**
     * Close the context and release native resources.
     */
    override fun close() {
        if (contextPtr != 0L) {
            nativeDestroy(contextPtr)
            contextPtr = 0L
        }
    }
    
    protected fun finalize() {
        close()
    }
}

/**
 * Callback interface for JS -> Kotlin calls.
 * Keep annotation prevents ProGuard from removing it.
 */
@Keep
internal class JsCallback(
    private val callback: (Array<String>) -> String?
) {
    @Keep
    fun invoke(args: Array<String>): String? = callback(args)
}
```

---

## Step 7: Create ProGuard Rules

Create `android/quickjs-engine/consumer-rules.pro`:

```proguard
# Keep JNI methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep callback class
-keep class com.jstorrent.quickjs.JsCallback { *; }
-keep class com.jstorrent.quickjs.QuickJsException { *; }
```

Create `android/quickjs-engine/proguard-rules.pro`:

```proguard
# Same as consumer rules for library builds
-keepclasseswithmembernames class * {
    native <methods>;
}
-keep class com.jstorrent.quickjs.JsCallback { *; }
-keep class com.jstorrent.quickjs.QuickJsException { *; }
```

---

## Step 8: Update settings.gradle.kts

Add to `android/settings.gradle.kts`:

```kotlin
rootProject.name = "JSTorrent"
include(":io-core")
include(":companion-server")
include(":quickjs-engine")  // ADD THIS
include(":app")
```

---

## Step 9: Create Unit Test

Create `android/quickjs-engine/src/test/kotlin/com/jstorrent/quickjs/QuickJsContextTest.kt`:

```kotlin
package com.jstorrent.quickjs

import org.junit.Test
import kotlin.test.assertEquals

/**
 * Unit tests that can run on JVM.
 * Note: These won't actually execute QuickJS (native code).
 * Use androidTest for real integration tests.
 */
class QuickJsContextTest {
    
    @Test
    fun `placeholder test`() {
        // Real tests need to be in androidTest since they require native code
        assertEquals(1 + 1, 2)
    }
}
```

---

## Step 10: Create Instrumented Test

Create `android/quickjs-engine/src/androidTest/kotlin/com/jstorrent/quickjs/QuickJsInstrumentedTest.kt`:

```kotlin
package com.jstorrent.quickjs

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class QuickJsInstrumentedTest {
    
    private lateinit var ctx: QuickJsContext
    
    @Before
    fun setUp() {
        ctx = QuickJsContext.create()
    }
    
    @After
    fun tearDown() {
        ctx.close()
    }
    
    @Test
    fun evaluateInteger() {
        val result = ctx.evaluate("1 + 2")
        assertEquals(3, result)
    }
    
    @Test
    fun evaluateDouble() {
        val result = ctx.evaluate("3.14 * 2")
        assertTrue(result is Double)
        assertEquals(6.28, result as Double, 0.001)
    }
    
    @Test
    fun evaluateString() {
        val result = ctx.evaluate("'hello' + ' world'")
        assertEquals("hello world", result)
    }
    
    @Test
    fun evaluateBoolean() {
        assertEquals(true, ctx.evaluate("true"))
        assertEquals(false, ctx.evaluate("false"))
    }
    
    @Test
    fun evaluateNull() {
        assertNull(ctx.evaluate("null"))
    }
    
    @Test
    fun evaluateUndefined() {
        assertNull(ctx.evaluate("undefined"))
    }
    
    @Test
    fun evaluateFunction() {
        ctx.evaluate("function add(a, b) { return a + b; }")
        val result = ctx.evaluate("add(5, 7)")
        assertEquals(12, result)
    }
    
    @Test
    fun globalFunctionCallback() {
        var capturedArgs: Array<String>? = null
        
        ctx.setGlobalFunction("myCallback") { args ->
            capturedArgs = args
            "result from kotlin"
        }
        
        val result = ctx.evaluate("myCallback('arg1', 'arg2')")
        
        assertEquals("result from kotlin", result)
        assertEquals(listOf("arg1", "arg2"), capturedArgs?.toList())
    }
    
    @Test
    fun multipleContexts() {
        val ctx2 = QuickJsContext.create()
        try {
            ctx.evaluate("var x = 1")
            ctx2.evaluate("var x = 2")
            
            assertEquals(1, ctx.evaluate("x"))
            assertEquals(2, ctx2.evaluate("x"))
        } finally {
            ctx2.close()
        }
    }
}
```

---

## Step 11: Build and Test

```bash
cd android

# Build the module
./gradlew :quickjs-engine:build

# Run instrumented tests (requires device/emulator)
./gradlew :quickjs-engine:connectedAndroidTest
```

---

## Verification Checklist

- [ ] quickjs-ng submodule added under `src/main/cpp/quickjs-ng/`
- [ ] CMakeLists.txt builds QuickJS + JNI wrapper
- [ ] `QuickJsContext.kt` compiles
- [ ] Module included in settings.gradle.kts
- [ ] `./gradlew :quickjs-engine:build` succeeds
- [ ] Instrumented tests pass on device/emulator

---

## API Summary

```kotlin
// Create context
val ctx = QuickJsContext.create()

// Evaluate JavaScript
val result = ctx.evaluate("1 + 2")  // Returns 3 (Int)
val str = ctx.evaluate("'hello'")   // Returns "hello" (String)

// Register Kotlin callback
ctx.setGlobalFunction("log") { args ->
    println(args.joinToString())
    null  // Return null for void
}
ctx.evaluate("log('Hello from JS!')")

// For promises (if needed)
ctx.evaluate("Promise.resolve().then(() => { /* ... */ })")
ctx.executeAllPendingJobs()

// Clean up
ctx.close()
```

---

## What's Next (Phase 3)

Phase 3 will extend this to register the `__jstorrent_*` bindings:

```kotlin
// TCP
ctx.setGlobalFunction("__jstorrent_tcp_connect") { args ->
    val socketId = args[0].toInt()
    val host = args[1]
    val port = args[2].toInt()
    tcpSocketManager.connect(socketId, host, port)
    null
}

// etc.
```

The callback pattern will need to evolve to support:
1. Binary data (ArrayBuffer) - pass as base64 or handle differently
2. Async callbacks (native -> JS) - need mechanism to invoke JS from Kotlin
