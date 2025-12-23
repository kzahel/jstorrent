cmake_minimum_required(VERSION 3.22.1)
project(quickjs-jni)

# QuickJS-ng source files (minimal set needed for the library)
set(QUICKJS_SRC
    quickjs-ng/cutils.c
    quickjs-ng/dtoa.c
    quickjs-ng/libregexp.c
    quickjs-ng/libunicode.c
    quickjs-ng/quickjs.c
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
    _GNU_SOURCE=1
)

# Link against Android log library (for __android_log_print)
find_library(log-lib log)
target_link_libraries(quickjs-jni ${log-lib})

# Find and link math library
find_library(m-lib m)
if(m-lib)
    target_link_libraries(quickjs-jni ${m-lib})
endif()

# Compiler options
target_compile_options(quickjs-jni PRIVATE
    -O2
    -fvisibility=hidden
    -fPIC
    -funsigned-char
    -Wno-implicit-fallthrough
    -Wno-sign-compare
    -Wno-missing-field-initializers
    -Wno-unused-parameter
    -Wno-unused-but-set-variable
    -Wno-unused-result
)

# C standard
set_target_properties(quickjs-jni PROPERTIES
    C_STANDARD 11
    C_STANDARD_REQUIRED ON
)
