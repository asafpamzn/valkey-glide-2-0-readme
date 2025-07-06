# AddressSanitizer (ASAN) Support for PHP Extension

This document explains how to use AddressSanitizer (ASAN) to debug memory issues in the Valkey Glide PHP extension.

## Prerequisites

1. **Compiler with ASAN support**: GCC 4.8+ or Clang 3.1+
2. **Dependencies**: Make sure you have `protobuf-c` installed
   ```bash
   # macOS
   brew install protobuf-c
   
   # Ubuntu/Debian
   sudo apt-get install libprotobuf-c-dev protobuf-c-compiler
   ```

## Quick Start

### Option 1: Using Make Targets (Recommended)

```bash
cd php/

# Build with ASAN and run tests
make test-asan

# Or step by step:
make build-asan      # Build with ASAN
make test-asan       # Run tests with ASAN
make clean-asan      # Clean up

# Get help
make help-asan
```

### Option 2: Manual Build

```bash
cd php/

# Clean previous builds
make clean
phpize --clean
phpize

# Configure with ASAN enabled
./configure --enable-valkey-glide --enable-valkey-glide-asan

# Build
make

# Run tests with ASAN
export ASAN_OPTIONS="detect_leaks=1:abort_on_error=0:symbolize=1:print_stacktrace=1"
php -n -d extension=$(pwd)/modules/valkey_glide.so tests/TestValkeyGlide.php
```

## ASAN Configuration

The build system automatically sets appropriate ASAN flags:
- **Compile flags**: `-fsanitize=address -fno-omit-frame-pointer -g -O1`
- **Link flags**: `-fsanitize=address`

Runtime options (automatically set by `make test-asan`):
- `detect_leaks=1`: Enable leak detection
- `abort_on_error=0`: Continue after first error (don't abort)
- `symbolize=1`: Show function names in stack traces
- `print_stacktrace=1`: Print stack traces for errors
- `log_path=./asan_logs`: Save reports to files

## Interpreting ASAN Output

### Memory Leak Example
```
=================================================================
==12345==ERROR: LeakSanitizer: detected memory leaks

Direct leak of 64 byte(s) in 1 object(s) allocated from:
    #0 0x... in calloc
    #1 0x... in PHP_METHOD(ValkeyGlide, __construct) php/valkey_glide.c:123
    #2 0x... in zend_call_function
```

### Use-After-Free Example
```
=================================================================
==12345==ERROR: AddressSanitizer: heap-use-after-free on address 0x...
READ of size 8 at 0x... thread T0:
    #0 0x... in some_function php/valkey_glide.c:456
```

## Troubleshooting

### "AddressSanitizer requested but compiler does not support it"
- Make sure you're using GCC 4.8+ or Clang 3.1+
- Try specifying the compiler: `CC=clang ./configure --enable-valkey-glide --enable-valkey-glide-asan`

### "library 'protobuf-c' not found"
- Install protobuf-c development libraries (see Prerequisites)
- On macOS, you might need: `export PKG_CONFIG_PATH="$(brew --prefix protobuf-c)/lib/pkgconfig:${PKG_CONFIG_PATH}"`

### No ASAN reports but expecting issues
- Verify ASAN is actually enabled: check that compilation shows ASAN flags
- Try running a simple test that should trigger ASAN (like accessing freed memory)

## Performance Impact

ASAN significantly slows down execution (2-3x) and increases memory usage (2-3x). This is normal and expected - only use ASAN builds for debugging, not production.

## Integration with CI

The CI system can use these same configure options to run ASAN builds automatically. The memory issues that were fixed in the codebase were discovered using this ASAN integration.
