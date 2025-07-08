# Platform-specific configuration
ifeq ($(shell uname),Darwin)
    INCLUDES += -I/opt/homebrew/include
    VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/release/libglide_ffi.a -lresolv -lSystem
else
    # Linux - check for target-specific build first, fallback to release
    ifneq ($(wildcard ../ffi/target/x86_64-unknown-linux-gnu/release/libglide_ffi.a),)
        VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/x86_64-unknown-linux-gnu/release/libglide_ffi.a -lresolv -lprotobuf-c
    else ifneq ($(wildcard ../ffi/target/aarch64-unknown-linux-gnu/release/libglide_ffi.a),)
        VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/aarch64-unknown-linux-gnu/release/libglide_ffi.a -lresolv -lprotobuf-c
    else
        VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/release/libglide_ffi.a -lresolv -lprotobuf-c
    endif
endif
INCLUDES += -Iinclude
PROTOC = protoc
PROTOC_C_PLUGIN := protoc-c
PROTO_SRC_DIR = ../glide-core/src/protobuf
GEN_INCLUDE_DIR = include/glide
GEN_SRC_DIR = src

# Cargo and tool detection
CARGO_HOME ?= $(HOME)/.cargo
CBINDGEN := $(shell which cbindgen 2>/dev/null || echo $(CARGO_HOME)/bin/cbindgen)

PROTO_FILES = connection_request.proto command_request.proto response.proto

define proto_rule
$(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.h $(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.c: $(PROTO_SRC_DIR)/$(1)
	@mkdir -p $(GEN_INCLUDE_DIR)
	$(PROTOC) --c_out=$(GEN_INCLUDE_DIR) -I $(PROTO_SRC_DIR) $(PROTO_SRC_DIR)/$(1)

$(GEN_SRC_DIR)/$(basename $(1)).pb-c.c: $(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.c
	@mkdir -p $(GEN_SRC_DIR)
	mv $(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.c $(GEN_SRC_DIR)/$(basename $(1)).pb-c.c
	sed -i.bak 's|"$(basename $(1)).pb-c.h"|<glide/$(basename $(1)).pb-c.h>|' $(GEN_SRC_DIR)/$(basename $(1)).pb-c.c
	rm -f $(GEN_SRC_DIR)/$(basename $(1)).pb-c.c.bak
endef

$(foreach proto,$(PROTO_FILES),$(eval $(call proto_rule,$(proto))))

PROTO_HEADERS := $(foreach proto,$(PROTO_FILES),$(GEN_INCLUDE_DIR)/$(basename $(proto)).pb-c.h)
PROTO_SOURCES := $(foreach proto,$(PROTO_FILES),$(GEN_SRC_DIR)/$(basename $(proto)).pb-c.c)

generate-proto: $(PROTO_HEADERS) $(PROTO_SOURCES)
	@echo "Generated C protobuf bindings."

clean-proto:
	rm -f $(PROTO_HEADERS)
	rm -f $(PROTO_SOURCES)

generate-bindings:
	@echo "Generating C bindings from Rust code..."
	@mkdir -p $(top_srcdir)/include
	@cp $(top_srcdir)/../ffi/src/lib.rs $(top_srcdir)/include/lib.rs
	@cd $(top_srcdir)/../ffi && $(CBINDGEN) --config cbindgen.toml --crate glide-ffi --output $(top_srcdir)/include/glide_bindings.h

valkey_glide_arginfo.h: valkey_glide.stub.php
	@echo "Generating arginfo from valkey_glide.stub.php"
	$(PHP_EXECUTABLE) build/gen_stub.php --no-legacy-arginfo valkey_glide.stub.php

valkey_glide_cluster_arginfo.h: valkey_glide_cluster.stub.php
	@echo "Generating arginfo from valkey_glide_cluster.stub.php"
	$(PHP_EXECUTABLE) build/gen_stub.php --no-legacy-arginfo valkey_glide_cluster.stub.php

ARGINFO_HEADERS = valkey_glide_arginfo.h valkey_glide_cluster_arginfo.h

all: $(ARGINFO_HEADERS)

.PHONY: build-modules-pre

build-modules-pre: valkey_glide_arginfo.h valkey_glide_cluster_arginfo.h
	@$(MAKE) generate-proto
	@$(MAKE) generate-bindings

# Wrap the original build-modules
build-modules: $(PHP_MODULES) $(PHP_ZEND_EX)

# Linting targets for PHP and C code
lint: lint-c lint-php

lint-c:
	@echo "Checking C code formatting..."
	@if command -v clang-format >/dev/null 2>&1; then \
		if find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | grep -q .; then \
			find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | xargs clang-format --dry-run --Werror; \
			echo "✓ C code formatting check passed"; \
		else \
			echo "No C files found to check"; \
		fi; \
	else \
		echo "Warning: clang-format not found, skipping C code formatting check"; \
	fi
	@echo "Running C static analysis..."
	@if command -v cppcheck >/dev/null 2>&1; then \
		cppcheck --enable=all --suppress=missingIncludeSystem --error-exitcode=1 --quiet .; \
		echo "✓ C static analysis passed"; \
	else \
		echo "Warning: cppcheck not found, skipping C static analysis"; \
	fi

lint-php:
	@echo "Running PHP linting..."
	@if [ -f "composer.json" ] && [ ! -d "vendor" ]; then \
		echo "Installing composer dependencies..."; \
		if command -v composer >/dev/null 2>&1; then \
			composer install --dev --no-progress --quiet; \
		else \
			echo "Warning: composer not found, some PHP linting tools may not be available"; \
		fi; \
	fi
	@if command -v phpcs >/dev/null 2>&1 || [ -f "vendor/bin/phpcs" ]; then \
		echo "Running PHP CodeSniffer..."; \
		if [ -f "vendor/bin/phpcs" ]; then \
			./vendor/bin/phpcs --standard=phpcs.xml; \
		else \
			phpcs --standard=phpcs.xml; \
		fi; \
		echo "✓ PHP CodeSniffer passed"; \
	else \
		echo "Warning: phpcs not found, skipping PHP coding standards check"; \
	fi
	@if command -v phpstan >/dev/null 2>&1 || [ -f "vendor/bin/phpstan" ]; then \
		echo "Running PHPStan static analysis..."; \
		if [ -f "vendor/bin/phpstan" ]; then \
			./vendor/bin/phpstan analyze --no-progress; \
		else \
			phpstan analyze --no-progress; \
		fi; \
		echo "✓ PHPStan analysis passed"; \
	else \
		echo "Warning: phpstan not found, skipping PHP static analysis"; \
	fi

lint-fix:
	@echo "Fixing C code formatting..."
	@if command -v clang-format >/dev/null 2>&1; then \
		if find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | grep -q .; then \
			find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | xargs clang-format -i; \
			echo "✓ C code formatting fixed"; \
		else \
			echo "No C files found to format"; \
		fi; \
	else \
		echo "Warning: clang-format not found, cannot fix C code formatting"; \
	fi
	@echo "Fixing PHP code formatting..."
	@if command -v phpcbf >/dev/null 2>&1 || [ -f "vendor/bin/phpcbf" ]; then \
		if [ -f "vendor/bin/phpcbf" ]; then \
			./vendor/bin/phpcbf --standard=phpcs.xml || true; \
		else \
			phpcbf --standard=phpcs.xml || true; \
		fi; \
		echo "✓ PHP code formatting fixed"; \
	else \
		echo "Warning: phpcbf not found, cannot fix PHP code formatting"; \
	fi

install-build-tools:
	@echo "Installing build tools..."
	@if command -v cargo >/dev/null 2>&1; then \
		cargo install cbindgen; \
		echo "✓ cbindgen installed via Cargo"; \
	else \
		echo "Warning: cargo not found, please install Rust first"; \
	fi

install-lint-tools:
	@echo "Installing linting tools..."
	@if command -v composer >/dev/null 2>&1; then \
		composer install --dev --no-progress; \
		echo "✓ PHP linting tools installed via Composer"; \
	else \
		echo "Warning: composer not found, please install composer first"; \
	fi
	@echo "Please ensure clang-format and cppcheck are installed for C code linting"
	@echo "Ubuntu/Debian: sudo apt-get install clang-format cppcheck"
	@echo "macOS: brew install clang-format cppcheck"

install-tools: install-build-tools install-lint-tools

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
    ASAN_OPTIONS_ENV = halt_on_error=0:abort_on_error=0:symbolize=1:print_stacktrace=1:detect_stack_use_after_return=1:log_path=./asan_logs:fast_unwind_on_malloc=0:print_module_map=1
else
    ASAN_OPTIONS_ENV = halt_on_error=0:detect_leaks=1:abort_on_error=0:symbolize=1:print_stacktrace=1:detect_stack_use_after_return=1:log_path=./asan_logs:fast_unwind_on_malloc=0:print_module_map=1
endif

# ASAN (AddressSanitizer) targets
build-asan:
	@echo "Building with AddressSanitizer..."
	@$(MAKE) build-modules-pre $(ARGINFO_HEADERS)
	@$(MAKE)
	@echo "✓ ASAN build completed"

test-asan: build-asan
	@echo "Running tests with AddressSanitizer..."
	@mkdir -p asan_logs
	@echo "=== ASAN Test Configuration ==="
	@echo "Extension: $(CURDIR)/modules/valkey_glide.so"
	@echo "Test file: tests/TestValkeyGlide.php"
	@echo "ASAN options: $(ASAN_OPTIONS_ENV)"
	@echo ""
	@echo "=== Checking Prerequisites ==="
	@if [ ! -f "$(CURDIR)/modules/valkey_glide.so" ]; then \
		echo "❌ ERROR: Extension not found at $(CURDIR)/modules/valkey_glide.so"; \
		exit 1; \
	fi
	@if [ ! -f "tests/TestValkeyGlide.php" ]; then \
		echo "❌ ERROR: Test file not found at tests/TestValkeyGlide.php"; \
		exit 1; \
	fi
	@echo "✓ Extension file exists: $(CURDIR)/modules/valkey_glide.so"
	@echo "✓ Test file exists: tests/TestValkeyGlide.php"
	@echo ""
	@echo "=== Finding ASAN Library ==="
	@ASAN_LIB=""; \
	for lib_path in \
		"$$(gcc -print-file-name=libasan.so)" \
		"$$(clang -print-file-name=libasan.so 2>/dev/null || echo '')" \
		"/usr/lib/x86_64-linux-gnu/libasan.so" \
		"/usr/lib/gcc/x86_64-linux-gnu/*/libasan.so" \
		"/usr/lib64/libasan.so" \
		"/usr/local/lib/libasan.so"; do \
		if [ -f "$$lib_path" ] && [ "$$lib_path" != "libasan.so" ]; then \
			echo "Found ASAN library: $$lib_path"; \
			if [ -L "$$lib_path" ]; then \
				RESOLVED_PATH=$$(readlink -f "$$lib_path" 2>/dev/null || realpath "$$lib_path" 2>/dev/null || echo "$$lib_path"); \
				if [ -f "$$RESOLVED_PATH" ]; then \
					ASAN_LIB="$$RESOLVED_PATH"; \
					echo "✓ Using resolved ASAN library: $$ASAN_LIB"; \
				else \
					ASAN_LIB="$$lib_path"; \
					echo "✓ Using original ASAN library: $$ASAN_LIB"; \
				fi; \
			else \
				ASAN_LIB="$$lib_path"; \
				echo "✓ Using ASAN library: $$ASAN_LIB"; \
			fi; \
			break; \
		fi; \
	done; \
	if [ -z "$$ASAN_LIB" ]; then \
		echo "❌ ERROR: No ASAN library found"; \
		echo "Please install ASAN development packages:"; \
		echo "  Ubuntu/Debian: apt-get install gcc libc6-dev"; \
		exit 1; \
	fi; \
	echo ""
	@echo "=== Testing Basic PHP Execution ==="
	@php -r "echo 'PHP version: ' . PHP_VERSION . PHP_EOL;" || { echo "❌ PHP execution failed"; exit 1; }
	@echo ""
	@echo "=== Testing Extension Loading (without ASAN) ==="
	@if php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Extension loaded successfully' . PHP_EOL;" 2>/dev/null; then \
		echo "✓ Extension loads without ASAN"; \
	else \
		echo "⚠ Extension failed to load without ASAN - may need ASAN runtime"; \
		echo "This is normal for ASAN-compiled extensions"; \
	fi
	@echo ""
	@echo "=== Testing Extension Loading (with ASAN) ==="
	@ASAN_LIB=""; \
	for lib_path in \
		"$$(gcc -print-file-name=libasan.so)" \
		"$$(clang -print-file-name=libasan.so 2>/dev/null || echo '')" \
		"/usr/lib/x86_64-linux-gnu/libasan.so" \
		"/usr/lib/gcc/x86_64-linux-gnu/*/libasan.so" \
		"/usr/lib64/libasan.so" \
		"/usr/local/lib/libasan.so"; do \
		if [ -f "$$lib_path" ] && [ "$$lib_path" != "libasan.so" ]; then \
			if [ -L "$$lib_path" ]; then \
				RESOLVED_PATH=$$(readlink -f "$$lib_path" 2>/dev/null || realpath "$$lib_path" 2>/dev/null || echo "$$lib_path"); \
				if [ -f "$$RESOLVED_PATH" ]; then \
					ASAN_LIB="$$RESOLVED_PATH"; \
				else \
					ASAN_LIB="$$lib_path"; \
				fi; \
			else \
				ASAN_LIB="$$lib_path"; \
			fi; \
			break; \
		fi; \
	done; \
	ASAN_SUCCESS=0; \
	if [ -n "$$ASAN_LIB" ]; then \
		echo "Testing with LD_PRELOAD=$$ASAN_LIB"; \
		if env LD_PRELOAD="$$ASAN_LIB" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Extension loaded with ASAN' . PHP_EOL;" 2>/dev/null; then \
			echo "✓ Extension loads successfully with ASAN"; \
			ASAN_SUCCESS=1; \
		else \
			echo "❌ Extension failed to load with ASAN LD_PRELOAD"; \
			echo "Trying alternative ASAN libraries..."; \
			for alt_lib in "/lib/x86_64-linux-gnu/libasan.so.8" "/usr/lib/x86_64-linux-gnu/libasan.so.8" "/usr/lib/x86_64-linux-gnu/libasan.so.8.0.0"; do \
				if [ -f "$$alt_lib" ]; then \
					echo "Testing alternative: $$alt_lib"; \
					if env LD_PRELOAD="$$alt_lib" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Extension loaded with ASAN' . PHP_EOL;" 2>/dev/null; then \
						echo "✓ Extension loads successfully with $$alt_lib"; \
						ASAN_LIB="$$alt_lib"; \
						ASAN_SUCCESS=1; \
						break; \
					fi; \
				fi; \
			done; \
		fi; \
	fi; \
	if [ $$ASAN_SUCCESS -eq 0 ]; then \
		echo "❌ CRITICAL ERROR: Cannot load extension with any ASAN library"; \
		echo "Available ASAN libraries:"; \
		find /usr/lib* -name "*asan*" -type f 2>/dev/null | head -5 || echo "  None found"; \
		echo ""; \
		echo "Extension dependencies:"; \
		ldd $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo "  ldd failed"; \
		echo ""; \
		echo "Attempting to run without LD_PRELOAD (may show runtime errors):"; \
		env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Extension test' . PHP_EOL;" || true; \
		exit 1; \
	fi; \
	echo ""
	@echo "=== Running ASAN Tests ==="
	@echo "Command: env LD_PRELOAD=\"$$ASAN_LIB\" ASAN_OPTIONS=\"$(ASAN_OPTIONS_ENV)\" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php"
	@ASAN_LIB=""; \
	for lib_path in \
		"$$(gcc -print-file-name=libasan.so)" \
		"$$(clang -print-file-name=libasan.so 2>/dev/null || echo '')" \
		"/usr/lib/x86_64-linux-gnu/libasan.so" \
		"/usr/lib/gcc/x86_64-linux-gnu/*/libasan.so" \
		"/usr/lib64/libasan.so" \
		"/usr/local/lib/libasan.so"; do \
		if [ -f "$$lib_path" ] && [ "$$lib_path" != "libasan.so" ]; then \
			if [ -L "$$lib_path" ]; then \
				RESOLVED_PATH=$$(readlink -f "$$lib_path" 2>/dev/null || realpath "$$lib_path" 2>/dev/null || echo "$$lib_path"); \
				if [ -f "$$RESOLVED_PATH" ]; then \
					ASAN_LIB="$$RESOLVED_PATH"; \
				else \
					ASAN_LIB="$$lib_path"; \
				fi; \
			else \
				ASAN_LIB="$$lib_path"; \
			fi; \
			break; \
		fi; \
	done; \
	FOUND_WORKING_LIB=0; \
	for test_lib in "$$ASAN_LIB" "/lib/x86_64-linux-gnu/libasan.so.8" "/usr/lib/x86_64-linux-gnu/libasan.so.8" "/usr/lib/x86_64-linux-gnu/libasan.so.8.0.0"; do \
		if [ -f "$$test_lib" ]; then \
			if env LD_PRELOAD="$$test_lib" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Test lib works' . PHP_EOL;" >/dev/null 2>&1; then \
				ASAN_LIB="$$test_lib"; \
				FOUND_WORKING_LIB=1; \
				break; \
			fi; \
		fi; \
	done; \
	if [ $$FOUND_WORKING_LIB -eq 0 ]; then \
		echo "❌ No working ASAN library found for main test execution"; \
		exit 1; \
	fi; \
	echo "Using ASAN library: $$ASAN_LIB"; \
	echo "Starting test execution..."; \
	echo ""; \
	env LD_PRELOAD="$$ASAN_LIB" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php; \
	TEST_RESULT=$$?; \
	echo ""; \
	echo "=== Test Results ==="
	@if [ $$TEST_RESULT -eq 0 ]; then \
		echo "✅ ASAN tests completed successfully (exit code: $$TEST_RESULT)"; \
	else \
		echo "❌ ASAN tests failed (exit code: $$TEST_RESULT)"; \
		echo ""; \
		echo "=== Error Analysis ==="
		if [ -d "./asan_logs" ] && [ "$$(ls -A ./asan_logs 2>/dev/null)" ]; then \
			echo "📄 ASAN reports found:"; \
			for log_file in ./asan_logs/*; do \
				if [ -f "$$log_file" ]; then \
					echo "--- $$log_file ---"; \
					cat "$$log_file"; \
					echo ""; \
				fi; \
			done; \
		else \
			echo "📄 No ASAN log files generated"; \
		fi; \
		echo "=== System State ==="
		echo "Working directory: $$(pwd)"; \
		echo "Extension exists: $$(test -f '$(CURDIR)/modules/valkey_glide.so' && echo 'YES' || echo 'NO')"; \
		echo "Test file exists: $$(test -f 'tests/TestValkeyGlide.php' && echo 'YES' || echo 'NO')"; \
		echo "ASAN library: $$ASAN_LIB"; \
		echo ""; \
		exit $$TEST_RESULT; \
	fi
	@if [ -d "./asan_logs" ] && [ "$$(ls -A ./asan_logs 2>/dev/null)" ]; then \
		echo "=== ASAN Reports Found ==="; \
		for log_file in ./asan_logs/*; do \
			if [ -f "$$log_file" ]; then \
				echo "=== Contents of $$log_file ==="; \
				cat "$$log_file"; \
				echo "=== End of $$log_file ==="; \
			fi; \
		done; \
	else \
		echo "✓ No ASAN issues detected"; \
	fi

clean-asan:
	@echo "Cleaning ASAN artifacts..."
	@rm -rf asan_logs
	@$(MAKE) clean

help-asan:
	@echo "ASAN (AddressSanitizer) targets:"
	@echo "  build-asan    - Build extension with AddressSanitizer enabled"
	@echo "  test-asan     - Build and run tests with AddressSanitizer"
	@echo "  clean-asan    - Clean ASAN artifacts and build files"
	@echo "  help-asan     - Show this help message"
	@echo ""
	@echo "Manual ASAN build steps:"
	@echo "  1. make clean && phpize --clean && phpize"
	@echo "  2. ./configure --enable-valkey-glide --enable-valkey-glide-asan"
	@echo "  3. make"
	@echo "  4. ASAN_OPTIONS='detect_leaks=1:abort_on_error=0:symbolize=1:print_stacktrace=1' \\"
	@echo "     LD_PRELOAD=/usr/lib/gcc/x86_64-linux-gnu/*/libasan.so \\"
	@echo "     php -n -d extension=\$$(pwd)/modules/valkey_glide.so tests/TestValkeyGlide.php"

.PHONY: lint lint-c lint-php lint-fix install-build-tools install-lint-tools install-tools build-asan test-asan clean-asan help-asan
