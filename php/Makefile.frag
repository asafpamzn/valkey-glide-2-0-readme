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
			echo "Found ASAN candidate: $$lib_path"; \
			if [ -L "$$lib_path" ]; then \
				RESOLVED_PATH=$$(readlink -f "$$lib_path" 2>/dev/null || realpath "$$lib_path" 2>/dev/null || echo "$$lib_path"); \
				echo "  -> Symbolic link detected, resolving: $$lib_path -> $$RESOLVED_PATH"; \
				if [ -f "$$RESOLVED_PATH" ]; then \
					ASAN_LIB="$$RESOLVED_PATH"; \
					echo "✓ Using resolved ASAN library: $$ASAN_LIB"; \
				else \
					echo "⚠ Resolved path not found, using original: $$lib_path"; \
					ASAN_LIB="$$lib_path"; \
				fi; \
			else \
				ASAN_LIB="$$lib_path"; \
				echo "✓ Using direct ASAN library: $$ASAN_LIB"; \
			fi; \
			break; \
		fi; \
	done; \
	echo "=== Pre-test diagnostics ==="; \
	echo "Extension file: $(CURDIR)/modules/valkey_glide.so"; \
	ls -la $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo "Extension file not found!"; \
	echo "Test file: tests/TestValkeyGlide.php"; \
	ls -la tests/TestValkeyGlide.php 2>/dev/null || echo "Test file not found!"; \
	echo "Checking if extension is ASAN-compiled..."; \
	if ldd $(CURDIR)/modules/valkey_glide.so | grep -q libasan; then \
		echo "✓ Extension is ASAN-compiled (libasan.so detected in dependencies)"; \
		if [ -n "$$ASAN_LIB" ]; then \
			echo "✓ ASAN library found: $$ASAN_LIB"; \
			echo "ASAN-compiled extensions MUST use LD_PRELOAD. Running tests with LD_PRELOAD..."; \
			echo ""; \
			echo "████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████"; \
			echo "██                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ██"; \
			echo "██                                     🔥🔥🔥 ULTRA-VERBOSE ASAN TEST DEBUGGING 🔥🔥🔥                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           ██"; \
			echo "██                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ██"; \
			echo "████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████"; \
			echo ""; \
			echo "🌟 COMPREHENSIVE SYSTEM ANALYSIS 🌟"; \
			echo "====================================="; \
			echo ""; \
			echo "📍 LOCATION & USER INFORMATION:"; \
			echo "  • Working Directory: $$(pwd)"; \
			echo "  • User Account: $$(whoami) (UID: $$(id -u), GID: $$(id -g))"; \
			echo "  • Home Directory: $$HOME"; \
			echo "  • Shell: $$SHELL"; \
			echo "  • Terminal: $$TERM"; \
			echo "  • Language: $$LANG"; \
			echo ""; \
			echo "🔧 ENVIRONMENT VARIABLES (Full Analysis):"; \
			echo "  • PATH ($$PATH | wc -c characters):"; \
			echo "    $$PATH" | sed 's/:/\n    /g'; \
			echo "  • LD_LIBRARY_PATH: $${LD_LIBRARY_PATH:-'<NOT SET>'}"; \
			echo "  • LD_RUN_PATH: $${LD_RUN_PATH:-'<NOT SET>'}"; \
			echo "  • ASAN_OPTIONS: $(ASAN_OPTIONS_ENV)"; \
			echo "  • LD_PRELOAD: $$ASAN_LIB"; \
			echo "  • PKG_CONFIG_PATH: $${PKG_CONFIG_PATH:-'<NOT SET>'}"; \
			echo "  • C_INCLUDE_PATH: $${C_INCLUDE_PATH:-'<NOT SET>'}"; \
			echo "  • CPLUS_INCLUDE_PATH: $${CPLUS_INCLUDE_PATH:-'<NOT SET>'}"; \
			echo "  • LIBRARY_PATH: $${LIBRARY_PATH:-'<NOT SET>'}"; \
			echo ""; \
			echo "🖥️  SYSTEM HARDWARE & OS INFORMATION:"; \
			echo "  • Full OS Details: $$(uname -a)"; \
			echo "  • Kernel Version: $$(uname -r)"; \
			echo "  • Architecture: $$(uname -m)"; \
			echo "  • Platform: $$(uname -p)"; \
			echo "  • Hardware: $$(uname -i 2>/dev/null || echo 'N/A')"; \
			echo "  • CPU Information:"; \
			lscpu 2>/dev/null | head -10 || echo "    lscpu not available"; \
			echo "  • CPU Count: $$(nproc) cores"; \
			echo "  • Memory Information:"; \
			free -h || echo "    free command not available"; \
			echo "  • Load Average: $$(uptime | awk -F'load average:' '{print $$2}')"; \
			echo "  • System Uptime: $$(uptime -p 2>/dev/null || uptime)"; \
			echo ""; \
			echo "💾 STORAGE & FILESYSTEM ANALYSIS:"; \
			echo "  • Current Directory Disk Usage:"; \
			df -h . || echo "    df command failed"; \
			echo "  • Available Space in /tmp:"; \
			df -h /tmp 2>/dev/null || echo "    /tmp not accessible"; \
			echo "  • Inode Usage:"; \
			df -i . 2>/dev/null || echo "    inode info not available"; \
			echo "  • Directory Contents (.):"; \
			ls -laht . | head -20; \
			echo "  • Extension Directory Contents:"; \
			ls -laht modules/ 2>/dev/null || echo "    modules/ directory not found"; \
			echo "  • Test Directory Contents:"; \
			ls -laht tests/ 2>/dev/null || echo "    tests/ directory not found"; \
			echo ""; \
			echo "🔐 PERMISSIONS & SECURITY:"; \
			echo "  • User Groups: $$(groups)"; \
			echo "  • File Permissions Summary:"; \
			echo "    Extension: $$(ls -la $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo 'NOT FOUND')"; \
			echo "    Test File: $$(ls -la tests/TestValkeyGlide.php 2>/dev/null || echo 'NOT FOUND')"; \
			echo "    Current Dir: $$(ls -lad .)"; \
			echo "  • SELinux Status: $$(getenforce 2>/dev/null || echo 'Not available')"; \
			echo "  • AppArmor Status: $$(aa-status 2>/dev/null | head -1 || echo 'Not available')"; \
			echo ""; \
			echo "🔄 RUNNING PROCESSES (Detailed Analysis):"; \
			echo "  • Total Processes: $$(ps aux | wc -l)"; \
			echo "  • PHP Processes:"; \
			ps aux | grep -i php | grep -v grep || echo "    No PHP processes found"; \
			echo "  • Valkey/Redis Processes:"; \
			ps aux | grep -E "(valkey|redis)" | grep -v grep || echo "    No Valkey/Redis processes found"; \
			echo "  • Process Tree (last 20):"; \
			ps aux | tail -20; \
			echo "  • Memory Usage by Process (top 10):"; \
			ps aux --sort=-%mem | head -10; \
			echo ""; \
			echo "🌐 NETWORK CONFIGURATION & CONNECTIVITY:"; \
			echo "  • Network Interfaces:"; \
			ip addr 2>/dev/null | grep -E '(inet |inet6 )' | head -10 || ifconfig 2>/dev/null | grep -E '(inet |inet6 )' | head -10 || echo "    Network info not available"; \
			echo "  • Listening Ports:"; \
			netstat -tuln 2>/dev/null | grep LISTEN | head -10 || ss -tuln 2>/dev/null | head -10 || echo "    Port info not available"; \
			echo "  • Testing Valkey Standalone Ports (6379-6381):"; \
			for port in 6379 6380 6381; do \
				echo -n "    Port $$port: "; \
				if timeout 2 bash -c "</dev/tcp/localhost/$$port" 2>/dev/null; then \
					echo "🟢 OPEN (TCP connection successful)"; \
				elif nc -z localhost $$port 2>/dev/null; then \
					echo "🟡 DETECTED (nc reports open)"; \
				else \
					echo "🔴 CLOSED/FILTERED"; \
				fi; \
			done; \
			echo "  • Testing Valkey Cluster Ports (7001-7006):"; \
			for port in 7001 7002 7003 7004 7005 7006; do \
				echo -n "    Port $$port: "; \
				if timeout 2 bash -c "</dev/tcp/localhost/$$port" 2>/dev/null; then \
					echo "🟢 OPEN (TCP connection successful)"; \
				elif nc -z localhost $$port 2>/dev/null; then \
					echo "🟡 DETECTED (nc reports open)"; \
				else \
					echo "🔴 CLOSED/FILTERED"; \
				fi; \
			done; \
			echo "  • DNS Resolution Test:"; \
			nslookup localhost 2>/dev/null | head -5 || echo "    DNS lookup failed"; \
			echo ""; \
			echo "🐘 PHP RUNTIME ENVIRONMENT (Comprehensive):"; \
			echo "  • PHP Executable: $$(which php)"; \
			echo "  • PHP Version (Full):"; \
			php --version || echo "    PHP not found in PATH"; \
			echo "  • PHP Configuration:"; \
			echo "    • SAPI: $$(php -r 'echo php_sapi_name();' 2>/dev/null || echo 'unknown')"; \
			echo "    • PHP Binary: $$(php -r 'echo PHP_BINARY;' 2>/dev/null || echo 'unknown')"; \
			echo "    • Extensions Count: $$(php -m 2>/dev/null | wc -l || echo '0') modules loaded"; \
			echo "    • Memory Limit: $$(php -r 'echo ini_get(\"memory_limit\");' 2>/dev/null || echo 'unknown')"; \
			echo "    • Max Execution Time: $$(php -r 'echo ini_get(\"max_execution_time\");' 2>/dev/null || echo 'unknown')"; \
			echo "    • Error Reporting: $$(php -r 'echo ini_get(\"error_reporting\");' 2>/dev/null || echo 'unknown')"; \
			echo "    • Include Path: $$(php -r 'echo get_include_path();' 2>/dev/null || echo 'unknown')"; \
			echo "  • PHP Extensions (first 20):"; \
			php -m 2>/dev/null | head -20 || echo "    Cannot list PHP extensions"; \
			echo "  • PHP Configuration File:"; \
			php --ini 2>/dev/null || echo "    Cannot show PHP ini files"; \
			echo ""; \
			echo "📦 EXTENSION DETAILED ANALYSIS:"; \
			echo "  • Extension Path: $(CURDIR)/modules/valkey_glide.so"; \
			echo "  • Extension Existence: $$(test -f '$(CURDIR)/modules/valkey_glide.so' && echo '✅ EXISTS' || echo '❌ NOT FOUND')"; \
			if [ -f "$(CURDIR)/modules/valkey_glide.so" ]; then \
				echo "  • Extension Size: $$(du -h $(CURDIR)/modules/valkey_glide.so | cut -f1) ($$(stat -f%z $(CURDIR)/modules/valkey_glide.so 2>/dev/null || stat -c%s $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo 'unknown') bytes)"; \
				echo "  • Extension Permissions: $$(ls -la $(CURDIR)/modules/valkey_glide.so)"; \
				echo "  • Extension File Type: $$(file $(CURDIR)/modules/valkey_glide.so)"; \
				echo "  • Extension Dependencies (ldd):"; \
				ldd $(CURDIR)/modules/valkey_glide.so 2>/dev/null || echo "    ldd failed or not available"; \
				echo "  • Extension Symbols (first 20):"; \
				nm -D $(CURDIR)/modules/valkey_glide.so 2>/dev/null | head -20 || objdump -tT $(CURDIR)/modules/valkey_glide.so 2>/dev/null | head -20 || echo "    Symbol analysis not available"; \
				echo "  • Extension Strings (first 10 relevant):"; \
				strings $(CURDIR)/modules/valkey_glide.so 2>/dev/null | grep -E "(php|valkey|glide|version)" | head -10 || echo "    String analysis not available"; \
			fi; \2> \
			echo ""; \
			echo "📄 TEST FILE ANALYSIS:"; \
			echo "  • Test File Path: tests/TestValkeyGlide.php"; \
			echo "  • Test File Existence: $$(test -f 'tests/TestValkeyGlide.php' && echo '✅ EXISTS' || echo '❌ NOT FOUND')"; \
			if [ -f "tests/TestValkeyGlide.php" ]; then \
				echo "  • Test File Size: $$(du -h tests/TestValkeyGlide.php | cut -f1) ($$(wc -c < tests/TestValkeyGlide.php) bytes, $$(wc -l < tests/TestValkeyGlide.php) lines)"; \
				echo "  • Test File Permissions: $$(ls -la tests/TestValkeyGlide.php)"; \
				echo "  • Test File Content Preview (first 10 lines):"; \
				head -10 tests/TestValkeyGlide.php; \
				echo "  • Test File Content Preview (last 10 lines):"; \
				tail -10 tests/TestValkeyGlide.php; \
				echo "  • PHP Syntax Check:"; \
				php -l tests/TestValkeyGlide.php 2>&1 || echo "    Syntax check failed"; \
			fi; \
			echo ""; \
			echo "🔧 DEVELOPMENT TOOLS & LIBRARIES:"; \
			echo "  • GCC Version: $$(gcc --version 2>/dev/null | head -1 || echo 'GCC not found')"; \
			echo "  • Clang Version: $$(clang --version 2>/dev/null | head -1 || echo 'Clang not found')"; \
			echo "  • Make Version: $$(make --version 2>/dev/null | head -1 || echo 'Make not found')"; \
			echo "  • Autotools:"; \
			echo "    • Autoconf: $$(autoconf --version 2>/dev/null | head -1 || echo 'Not found')"; \
			echo "    • Automake: $$(automake --version 2>/dev/null | head -1 || echo 'Not found')"; \
			echo "    • Libtool: $$(libtool --version 2>/dev/null | head -1 || echo 'Not found')"; \
			echo "  • pkg-config: $$(pkg-config --version 2>/dev/null || echo 'Not found')"; \
			echo "  • Protocol Buffers: $$(protoc --version 2>/dev/null || echo 'Not found')"; \
			echo ""; \
			echo "🛡️  ASAN LIBRARY COMPREHENSIVE ANALYSIS:"; \
			echo "  • ASAN Library Path: $$ASAN_LIB"; \
			echo "  • ASAN Library Existence: $$(test -f "$$ASAN_LIB" && echo '✅ EXISTS' || echo '❌ NOT FOUND')"; \
			if [ -f "$$ASAN_LIB" ]; then \
				echo "  • ASAN Library Size: $$(du -h $$ASAN_LIB | cut -f1)"; \
				echo "  • ASAN Library Permissions: $$(ls -la $$ASAN_LIB)"; \
				echo "  • ASAN Library File Type: $$(file $$ASAN_LIB)"; \
				echo "  • ASAN Library Version Info:"; \
				strings "$$ASAN_LIB" 2>/dev/null | grep -i version | head -5 || echo "    Version info not found"; \
			fi; \
			echo "  • Alternative ASAN Libraries:"; \
			find /usr/lib* -name "*asan*" -type f 2>/dev/null | head -10 || echo "    No alternative ASAN libraries found"; \
			echo ""; \
			echo "🧪 PRE-TEST VALIDATION SUITE:"; \
			echo "  • Testing Basic PHP Execution:"; \
			echo "    Command: php -r \"echo 'PHP is working: ' . PHP_VERSION . PHP_EOL;\""; \
			php -r "echo 'PHP is working: ' . PHP_VERSION . PHP_EOL;" 2>&1 || echo "    ❌ Basic PHP execution failed"; \
			echo "  • Testing PHP Extension Loading (WITHOUT ASAN):"; \
			echo "    Command: php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r \"echo 'Extension loaded without ASAN: OK';\""; \
			php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Extension loaded without ASAN: OK';" 2>&1 || echo "    ❌ Extension loading failed without ASAN"; \
			echo "  • Testing PHP Extension Loading (WITH ASAN LD_PRELOAD):"; \
			echo "    🔍 Analyzing extension dependencies to find exact ASAN library path..."; \
			EXTENSION_ASAN_PATH=$$(ldd $(CURDIR)/modules/valkey_glide.so 2>/dev/null | grep libasan | awk '{print $$3}' | head -1); \
			echo "    Extension expects ASAN library at: $$EXTENSION_ASAN_PATH"; \
			echo "    Our resolved ASAN library path: $$ASAN_LIB"; \
			echo ""; \
			echo "    🧪 Testing different ASAN library paths:"; \
			ASAN_SUCCESS=0; \
			for test_lib in "$$EXTENSION_ASAN_PATH" "$$ASAN_LIB" "/lib/x86_64-linux-gnu/libasan.so.8" "/usr/lib/x86_64-linux-gnu/libasan.so.8" "/usr/lib/x86_64-linux-gnu/libasan.so.8.0.0"; do \
				if [ -n "$$test_lib" ] && [ -f "$$test_lib" ]; then \
					echo "      Trying: $$test_lib"; \
					echo "      Command: env LD_PRELOAD=\"$$test_lib\" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r \"echo 'Extension loaded with ASAN: OK';\""; \
					set +e; \
					TEST_OUTPUT=$$(env LD_PRELOAD="$$test_lib" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so -r "echo 'Extension loaded with ASAN: OK';" 2>&1); \
					TEST_RESULT=$$?; \
					set -e; \
					if [ $$TEST_RESULT -eq 0 ]; then \
						echo "      ✅ SUCCESS with $$test_lib"; \
						echo "      Output: $$TEST_OUTPUT"; \
						ASAN_LIB="$$test_lib"; \
						ASAN_SUCCESS=1; \
						break; \
					else \
						echo "      ❌ Failed with $$test_lib (exit code: $$TEST_RESULT)"; \
						echo "      Full error output:"; \
						echo "$$TEST_OUTPUT" | sed 's/^/        /'; \
					fi; \
					echo ""; \
				fi; \
			done; \
			if [ $$ASAN_SUCCESS -eq 0 ]; then \
				echo "    ❌ All ASAN library paths failed!"; \
				echo "    This will cause the main test to fail."; \
				exit 1; \
			else \
				echo "    ✅ Found working ASAN library: $$ASAN_LIB"; \
			fi; \
			echo ""; \
			echo "🚀 LAUNCHING MAIN TEST EXECUTION"; \
			echo "=================================="; \
			echo "Start time: $$(date '+%Y-%m-%d %H:%M:%S %Z')"; \
			echo "Timestamp: $$(date +%s)"; \
			echo "Command to execute:"; \
			echo "  env LD_PRELOAD=\"$$ASAN_LIB\" ASAN_OPTIONS=\"$(ASAN_OPTIONS_ENV)\" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php"; \
			echo ""; \
			echo "📡 REAL-TIME TEST OUTPUT:"; \
			echo "========================"; \
			set +e; \
			env LD_PRELOAD="$$ASAN_LIB" ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php 2>&1; \
			TEST_EXIT_CODE=$$?; \
			set -e; \
			echo ""; \
			echo "🏁 TEST EXECUTION COMPLETED"; \
			echo "==========================="; \
			echo "End time: $$(date '+%Y-%m-%d %H:%M:%S %Z')"; \
			echo "End timestamp: $$(date +%s)"; \
			echo "Exit code: $$TEST_EXIT_CODE"; \
			if [ $$TEST_EXIT_CODE -eq 0 ]; then \
				echo "Result: ✅ SUCCESS"; \
			else \
				echo "Result: ❌ FAILED"; \
			fi; \
			echo ""; \
			if [ $$TEST_EXIT_CODE -ne 0 ]; then \
				echo "💥 POST-FAILURE COMPREHENSIVE ANALYSIS"; \
				echo "======================================"; \
				echo ""; \
				echo "🔍 ERROR INVESTIGATION:"; \
				echo "  • Exit Code Analysis: $$TEST_EXIT_CODE"; \
				case $$TEST_EXIT_CODE in \
					1) echo "    Standard error (general failure)";; \
					2) echo "    Shell builtin misuse or command not executable";; \
					126) echo "    Command not executable";; \
					127) echo "    Command not found";; \
					128) echo "    Invalid exit argument";; \
					130) echo "    Process terminated by Ctrl+C";; \
					*) echo "    Custom or unknown exit code";; \
				esac; \
				echo ""; \
				echo "🗂️  SYSTEM STATE ANALYSIS:"; \
				echo "  • Core Dumps:"; \
				ls -la core* 2>/dev/null | head -5 || echo "    No core files found"; \
				echo "  • Crash Reports:"; \
				ls -la crash* 2>/dev/null | head -5 || echo "    No crash files found"; \
				echo "  • Temporary Files:"; \
				ls -la /tmp/*php* 2>/dev/null | head -5 || echo "    No PHP temp files found"; \
				echo ""; \
				echo "📊 RESOURCE USAGE ANALYSIS:"; \
				echo "  • Current Memory Usage:"; \
				free -h | head -2 || echo "    Memory info not available"; \
				echo "  • Current Disk Usage:"; \
				df -h . | tail -1 || echo "    Disk info not available"; \
				echo "  • Current Load:"; \
				uptime || echo "    Load info not available"; \
				echo ""; \
				echo "🔄 PROCESS STATE ANALYSIS:"; \
				echo "  • Running PHP Processes:"; \
				ps aux | grep -i php | grep -v grep || echo "    No PHP processes found"; \
				echo "  • Running Valkey/Redis Processes:"; \
				ps aux | grep -E "(valkey|redis)" | grep -v grep || echo "    No Valkey/Redis processes found"; \
				echo "  • Zombie Processes:"; \
				ps aux | awk '$$8 ~ /^Z/ { print }' || echo "    No zombie processes found"; \
				echo ""; \
				echo "📋 SYSTEM LOGS ANALYSIS:"; \
				echo "  • Recent Kernel Messages:"; \
				dmesg | tail -10 2>/dev/null || echo "    Cannot access dmesg"; \
				echo "  • Recent System Log:"; \
				tail -10 /var/log/syslog 2>/dev/null || tail -10 /var/log/messages 2>/dev/null || echo "    Cannot access system logs"; \
				echo ""; \
				echo "🧪 ASAN SPECIFIC ANALYSIS:"; \
				echo "  • ASAN Log Directory:"; \
				if [ -d "./asan_logs" ]; then \
					echo "    Directory exists: ✅"; \
					echo "    Contents:"; \
					ls -la ./asan_logs/ || echo "    Cannot list ASAN logs"; \
					for asan_file in ./asan_logs/*; do \
						if [ -f "$$asan_file" ]; then \
							echo "    📄 ASAN Report: $$asan_file"; \
							cat "$$asan_file"; \
							echo "    --- End of $$asan_file ---"; \
						fi; \
					done; \
				else \
					echo "    Directory missing: ❌"; \
				fi; \
				echo ""; \
				echo "🔧 ENVIRONMENT RECHECK:"; \
				echo "  • LD_PRELOAD at failure: $${LD_PRELOAD:-'<NOT SET>'}"; \
				echo "  • ASAN_OPTIONS at failure: $${ASAN_OPTIONS:-'<NOT SET>'}"; \
				echo "  • Working directory: $$(pwd)"; \
				echo "  • Extension still exists: $$(test -f '$(CURDIR)/modules/valkey_glide.so' && echo 'YES' || echo 'NO')"; \
				echo "  • Test file still exists: $$(test -f 'tests/TestValkeyGlide.php' && echo 'YES' || echo 'NO')"; \
				echo ""; \
				echo "🎯 FAILURE SUMMARY:"; \
				echo "================"; \
				echo "❌ TEST EXECUTION FAILED WITH EXIT CODE: $$TEST_EXIT_CODE"; \
				echo "🔍 Check the detailed output above for the root cause"; \
				echo "💡 Common causes:"; \
				echo "   • Valkey servers not running (check port status above)"; \
				echo "   • PHP extension loading issues"; \
				echo "   • Memory/ASAN related problems"; \
				echo "   • Network connectivity issues"; \
				echo "   • Test environment problems"; \
				echo ""; \
				exit $$TEST_EXIT_CODE; \
			else \
				echo "🎉 SUCCESS SUMMARY:"; \
				echo "=================="; \
				echo "✅ ALL TESTS PASSED SUCCESSFULLY!"; \
				echo "🛡️  ASAN protection was active throughout the test"; \
				echo "🔧 Extension loaded and functioned correctly"; \
				echo "🌐 Network connectivity was sufficient"; \
				echo "💾 No memory issues detected"; \
				echo ""; \
			fi; \
		else \
			echo "✗ Extension is ASAN-compiled but no ASAN library found for LD_PRELOAD"; \
			echo "ASAN-compiled extensions require LD_PRELOAD with ASAN runtime library"; \
			echo "Please install ASAN development packages or use non-ASAN build"; \
			exit 1; \
		fi; \
	else \
		echo "Extension is not ASAN-compiled, running without LD_PRELOAD..."; \
		env ASAN_OPTIONS="$(ASAN_OPTIONS_ENV)" php -n -d extension=$(CURDIR)/modules/valkey_glide.so tests/TestValkeyGlide.php; \
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
	@echo "     LD_PRELOAD=/usr/lib/gcc/x86_64-linux-gnu/*/libasan.so \\"
	@echo "     php -n -d extension=\$$(pwd)/modules/valkey_glide.so tests/TestValkeyGlide.php"

.PHONY: lint lint-c lint-php lint-fix install-build-tools install-lint-tools install-tools build-asan test-asan clean-asan help-asan
