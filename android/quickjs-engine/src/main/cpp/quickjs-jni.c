#include <jni.h>
#include <android/log.h>
#include <string.h>
#include <stdlib.h>
#include "quickjs.h"

#define LOG_TAG "QuickJS-JNI"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

// -----------------------------------------------------------------------------
// Callback class for storing Kotlin callbacks
// -----------------------------------------------------------------------------
static JSClassID js_callback_class_id = 0;

typedef struct {
    JavaVM *jvm;
    jobject callback;      // Global ref to Kotlin callback
    jmethodID invokeMethod;
} JsCallbackData;

static void js_callback_finalizer(JSRuntime *rt, JSValue val) {
    (void)rt;
    JsCallbackData *data = (JsCallbackData *)JS_GetOpaque(val, js_callback_class_id);
    if (data) {
        // Get JNIEnv to release global ref
        JNIEnv *env = NULL;
        jint status = (*data->jvm)->GetEnv(data->jvm, (void **)&env, JNI_VERSION_1_6);
        if (status == JNI_OK && env) {
            (*env)->DeleteGlobalRef(env, data->callback);
        }
        free(data);
        LOGD("Callback data finalized");
    }
}

static JSClassDef js_callback_class = {
    "JsCallbackData",
    .finalizer = js_callback_finalizer,
};

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

        // Check if it's an integer that fits in int32
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
    (void)clazz;

    JSRuntime *rt = JS_NewRuntime();
    if (!rt) {
        jclass cls = (*env)->FindClass(env, "com/jstorrent/quickjs/QuickJsException");
        (*env)->ThrowNew(env, cls, "Failed to create QuickJS runtime");
        return 0;
    }

    // Register our callback class if not yet registered
    if (js_callback_class_id == 0) {
        JS_NewClassID(rt, &js_callback_class_id);
    }
    JS_NewClass(rt, js_callback_class_id, &js_callback_class);

    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) {
        JS_FreeRuntime(rt);
        jclass cls = (*env)->FindClass(env, "com/jstorrent/quickjs/QuickJsException");
        (*env)->ThrowNew(env, cls, "Failed to create QuickJS context");
        return 0;
    }

    LOGD("QuickJS context created: %p", ctx);
    return (jlong)(intptr_t)ctx;
}

// -----------------------------------------------------------------------------
// JNI: Destroy runtime and context
// -----------------------------------------------------------------------------
JNIEXPORT void JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeDestroy(JNIEnv *env, jclass clazz, jlong ctxPtr) {
    (void)env;
    (void)clazz;

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
    (void)clazz;

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
    (void)this_val;
    (void)magic;

    JsCallbackData *data = (JsCallbackData *)JS_GetOpaque(*func_data, js_callback_class_id);
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
    (void)clazz;

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

    // Create opaque JSValue to hold callback data (with our registered class)
    JSValue funcData = JS_NewObjectClass(ctx, js_callback_class_id);
    JS_SetOpaque(funcData, data);

    // Create JS function with callback (this duplicates funcData internally)
    JSValue func = JS_NewCFunctionData(ctx, js_kotlin_callback, 0, 0, 1, &funcData);

    // Free our local reference to funcData (the function now owns it)
    JS_FreeValue(ctx, funcData);

    // Set on global object
    const char *nameStr = (*env)->GetStringUTFChars(env, name, NULL);
    JSValue global = JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx, global, nameStr, func);
    JS_FreeValue(ctx, global);

    LOGD("Registered global function: %s", nameStr);
    (*env)->ReleaseStringUTFChars(env, name, nameStr);
}

// -----------------------------------------------------------------------------
// JNI: Execute pending jobs (for promises)
// Returns: true if there are more jobs pending
// -----------------------------------------------------------------------------
JNIEXPORT jboolean JNICALL
Java_com_jstorrent_quickjs_QuickJsContext_nativeExecutePendingJob(JNIEnv *env, jclass clazz, jlong ctxPtr) {
    (void)env;
    (void)clazz;

    JSContext *ctx = (JSContext *)(intptr_t)ctxPtr;
    JSContext *ctx2;
    int ret = JS_ExecutePendingJob(JS_GetRuntime(ctx), &ctx2);
    return ret > 0 ? JNI_TRUE : JNI_FALSE;
}
