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
	@echo "Detecting AddressSanitizer library..."
	@ASAN_LIB=""; \
	for lib_path in \
		"$$(gcc -print-file-name=libasan.so)" \
		"$$(clang -print-file-name=libasan.so 2>/dev/null || echo '')" \
		"/usr/lib/x86_64-linux-gnu/libasan.so" \
		"/usr/lib/gcc/x86_64-linux-gnu/*/libasan.so" \
		"/usr/lib64/libasan.so" \
		"/usr/local/lib/libasan.so"; do \
		if [ -f "$$lib_path" ] && [ "$$lib_path" != "libasan.so" ]; then \
			ASAN_LIB="$$lib_path"; \
			echo "Found ASAN library: $$ASAN_LIB"; \
			break; \
		fi; \
	done; \
	echo "=== Pre-test diagnostics ==="; \
	echo "Extension file: $(CURDIR)/modules/valkey_glide.so"; \
	ls -la $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo "Extension file not found!"; \
	echo "Test file: tests/TestValkeyGlide.php"; \
	ls -la tests/TestValkeyGlide.php 2>/dev/null || echo "Test file not found!"; \
	echo "Checking PHP extension loading..."; \
	if [ -n "$$ASAN_LIB" ]; then \
		echo "Testing PHP extension loading with ASAN LD_PRELOAD..."; \
		if env LD_PRELOAD="$$ASAN_LIB" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'PHP extension loads successfully with ASAN LD_PRELOAD\n';" 2>&1; then \
			echo "✓ Extension loads with LD_PRELOAD, running full test suite..."; \
			env LD_PRELOAD="$$ASAN_LIB" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php; \
		else \
			echo "⚠ Extension failed to load with LD_PRELOAD, trying to show error:"; \
			env LD_PRELOAD="$$ASAN_LIB" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'This should not print if extension loading fails\n';" 2>&1 || true; \
			echo "Falling back to compiled ASAN flags..."; \
			echo "Testing PHP extension loading without LD_PRELOAD..."; \
			if env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'PHP extension loads successfully with compiled ASAN\n';" 2>&1; then \
				echo "✓ Extension loads without LD_PRELOAD, running tests with compiled ASAN flags..."; \
				env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php; \
			else \
				echo "✗ Extension failed to load even without LD_PRELOAD, showing error:"; \
				env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'This should not print if extension loading fails\n';" 2>&1 || true; \
				echo "Debugging information:"; \
				echo "PHP version: $$(php --version | head -n1)"; \
				echo "Extension dependencies (ldd):"; \
				ldd $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo "ldd failed"; \
				echo "Extension file type:"; \
				file $(CURDIR)/modules/valkey_glide.so; \
				exit 1; \
			fi; \
		fi; \
	else \
		echo "No ASAN library found for LD_PRELOAD, testing extension loading with compiled ASAN flags..."; \
		if env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'PHP extension loads successfully with compiled ASAN\n';" 2>&1; then \
			echo "✓ Extension loads with compiled ASAN flags, running tests..."; \
			env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php; \
		else \
			echo "✗ Extension failed to load, showing error:"; \
			env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'This should not print if extension loading fails\n';" 2>&1 || true; \
			echo "Debugging information:"; \
			echo "PHP version: $$(php --version | head -n1)"; \
			echo "Extension dependencies (ldd):"; \
			ldd $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo "ldd failed"; \
			echo "Extension file type:"; \
			file $(CURDIR)/modules/valkey_glide.so; \
			exit 1; \
		fi; \
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
		echo "✓ No ASAN issues detected in log files"; \
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
	@echo "     php -n -d extension=\$$(pwd)/modules/valkey_glide.so tests/TestValkeyGlide.php"

.PHONY: lint lint-c lint-php lint-fix install-build-tools install-lint-tools install-tools build-asan test-asan clean-asan help-asan
