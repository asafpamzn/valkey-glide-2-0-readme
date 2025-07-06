/*
  +----------------------------------------------------------------------+
  +----------------------------------------------------------------------+
  | Copyright (c) 2023-2025 The PHP Group                                |
  +----------------------------------------------------------------------+
  | This source file is subject to version 3.01 of the PHP license,      |
  | that is bundled with this package in the file LICENSE, and is        |
  | available through the world-wide-web at the following url:           |
  | http://www.php.net/license/3_01.txt                                  |
  | If you did not receive a copy of the PHP license and are unable to   |
  | obtain it through the world-wide-web, please send a note to          |
  | license@php.net so we can mail you a copy immediately.               |
  +----------------------------------------------------------------------+
*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "command_response.h"
#include "include/glide_bindings.h"
#include "valkey_glide_commands_common.h"
#include "valkey_glide_core_common.h"

/* Execute a WAIT command using the Valkey Glide client - MIGRATED TO CORE FRAMEWORK */
int execute_wait_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    long                 numreplicas, timeout;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "Oll", &object, ce, &numreplicas, &timeout) ==
        FAILURE) {
        return 0;
    }
    if (numreplicas < 0) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        core_command_args_t args = {0};
        args.glide_client        = valkey_glide->glide_client;
        args.cmd_type            = Wait;

        /* WAIT is a server-level command (not key-based) with 2 arguments: numreplicas, timeout */
        args.args[0].type                = CORE_ARG_TYPE_LONG;
        args.args[0].data.long_arg.value = numreplicas;

        args.args[1].type                = CORE_ARG_TYPE_LONG;
        args.args[1].data.long_arg.value = timeout;
        args.arg_count                   = 2;

        long result_value;
        if (execute_core_command(&args, &result_value, process_core_int_result)) {
            /* Return the number of replicas that acknowledged the write */
            ZVAL_LONG(return_value, result_value);
            return 1;
        }
    }

    return 0;
}

/* Execute a FUNCTION command using the Valkey Glide client */
int execute_function_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    zval*                z_args;
    int                  args_count;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "O*", &object, ce, &z_args, &args_count) ==
        FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        /* Check if args are valid */
        if (!z_args || args_count <= 0) {
            return 0;
        }

        /* Prepare command arguments */
        unsigned long  arg_count = args_count;
        uintptr_t*     cmd_args  = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
        unsigned long* args_len  = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));

        if (!cmd_args || !args_len) {
            if (cmd_args)
                efree(cmd_args);
            if (args_len)
                efree(args_len);
            return 0;
        }

        /* Convert arguments to strings if needed */
        int i;
        for (i = 0; i < args_count; i++) {
            zval* arg = &z_args[i];

            /* If not string, convert to one */
            if (Z_TYPE_P(arg) != IS_STRING) {
                zval temp;
                ZVAL_COPY(&temp, arg);
                convert_to_string(&temp);
                cmd_args[i] = (uintptr_t)Z_STRVAL(temp);
                args_len[i] = Z_STRLEN(temp);
                zval_dtor(&temp);
            } else {
                cmd_args[i] = (uintptr_t)Z_STRVAL_P(arg);
                args_len[i] = Z_STRLEN_P(arg);
            }
        }

        /* Set the first argument as "FUNCTION" */
        const char*    function_cmd = "FUNCTION";
        uintptr_t*     final_args   = (uintptr_t*)emalloc((arg_count + 1) * sizeof(uintptr_t));
        unsigned long* final_args_len =
            (unsigned long*)emalloc((arg_count + 1) * sizeof(unsigned long));

        if (!final_args || !final_args_len) {
            if (cmd_args)
                efree(cmd_args);
            if (args_len)
                efree(args_len);
            if (final_args)
                efree(final_args);
            if (final_args_len)
                efree(final_args_len);
            return 0;
        }

        final_args[0]     = (uintptr_t)function_cmd;
        final_args_len[0] = strlen(function_cmd);

        /* Copy the rest of the arguments */
        for (i = 0; i < arg_count; i++) {
            final_args[i + 1]     = cmd_args[i];
            final_args_len[i + 1] = args_len[i];
        }

        /* Execute the command */
        CommandResult* result =
            execute_command(valkey_glide->glide_client,
                            CustomCommand, /* FUNCTION commands use custom command type */
                            arg_count + 1, /* FUNCTION command + args */
                            final_args,    /* arguments */
                            final_args_len /* argument lengths */
            );

        /* Free the argument arrays */
        efree(cmd_args);
        efree(args_len);
        efree(final_args);
        efree(final_args_len);

        /* Handle the result directly */
        int status = 0;
        if (result) {
            if (result->command_error) {
                /* Command failed */
                free_command_result(result);
                return 0;
            }

            if (result->response) {
                /* FUNCTION can return various types based on subcommand */
                status = command_response_to_zval(
                    result->response, return_value, COMMAND_RESPONSE_NOT_ASSOSIATIVE, false);
                free_command_result(result);
                return status;
            }
            free_command_result(result);
        }
    }

    return 0;
}

/* Execute a MULTI command using the Valkey Glide client - MIGRATED TO CORE FRAMEWORK */
int execute_multi_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "O", &object, ce) == FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        core_command_args_t args = {0};
        args.glide_client        = valkey_glide->glide_client;
        args.cmd_type            = Multi;

        if (execute_core_command(&args, NULL, process_core_bool_result)) {
            /* Return $this */
            ZVAL_COPY(return_value, object);
            return 1;
        }
    }

    return 0;
}

/* Execute a DISCARD command using the Valkey Glide client - MIGRATED TO CORE FRAMEWORK */
int execute_discard_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "O", &object, ce) == FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        core_command_args_t args = {0};
        args.glide_client        = valkey_glide->glide_client;
        args.cmd_type            = Discard;

        if (execute_core_command(&args, NULL, process_core_bool_result)) {
            ZVAL_TRUE(return_value);
            return 1;
        }
    }

    return 0;
}

/* Execute an EXEC command using the Valkey Glide client - MIGRATED TO CORE FRAMEWORK */
int execute_exec_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "O", &object, ce) == FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        core_command_args_t args = {0};
        args.glide_client        = valkey_glide->glide_client;
        args.cmd_type            = Exec;

        if (execute_core_command(&args, return_value, process_core_array_result)) {
            return 1;
        }
    }

    return 0;
}

/* Execute an FCALL command using the Valkey Glide client */
int execute_fcall_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    char*                name = NULL;
    size_t               name_len;
    long                 numkeys    = 0;
    zval*                z_args     = NULL;
    int                  args_count = 0;

    /* Parse parameters */
    if (zend_parse_method_parameters(
            argc, object, "Osl*", &object, ce, &name, &name_len, &numkeys, &z_args, &args_count) ==
        FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        /* Check if name is valid */
        if (!name || name_len <= 0) {
            return 0;
        }

        /* Prepare numkeys as string */
        char numkeys_str[32];
        snprintf(numkeys_str, sizeof(numkeys_str), "%ld", numkeys);

        /* Calculate total arguments: function_name + numkeys + all additional args */
        unsigned long  arg_count = 2 + args_count; /* name + numkeys + additional args */
        uintptr_t*     cmd_args  = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
        unsigned long* args_len  = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));

        if (!cmd_args || !args_len) {
            if (cmd_args)
                efree(cmd_args);
            if (args_len)
                efree(args_len);
            return 0;
        }

        /* Set function name and numkeys */
        cmd_args[0] = (uintptr_t)name;
        args_len[0] = name_len;
        cmd_args[1] = (uintptr_t)numkeys_str;
        args_len[1] = strlen(numkeys_str);

        /* Convert additional arguments to strings if needed */
        int i;
        for (i = 0; i < args_count; i++) {
            zval* arg = &z_args[i];

            /* If not string, convert to one */
            if (Z_TYPE_P(arg) != IS_STRING) {
                zval temp;
                ZVAL_COPY(&temp, arg);
                convert_to_string(&temp);
                cmd_args[i + 2] = (uintptr_t)Z_STRVAL(temp);
                args_len[i + 2] = Z_STRLEN(temp);
                zval_dtor(&temp);
            } else {
                cmd_args[i + 2] = (uintptr_t)Z_STRVAL_P(arg);
                args_len[i + 2] = Z_STRLEN_P(arg);
            }
        }

        /* Execute the command */
        CommandResult* result = execute_command(valkey_glide->glide_client,
                                                FCall,     /* command type */
                                                arg_count, /* number of arguments */
                                                cmd_args,  /* arguments */
                                                args_len   /* argument lengths */
        );

        /* Free the argument arrays */
        efree(cmd_args);
        efree(args_len);

        /* Handle the result directly */
        int status = 0;
        if (result) {
            if (result->command_error) {
                /* Command failed */
                free_command_result(result);
                return 0;
            }

            if (result->response) {
                /* FCALL can return various types */
                status = command_response_to_zval(
                    result->response, return_value, COMMAND_RESPONSE_NOT_ASSOSIATIVE, false);
                free_command_result(result);
                return status;
            }
            free_command_result(result);
        }
    }

    return 0;
}

/* Execute an FCALL_RO command using the Valkey Glide client */
int execute_fcall_ro_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    char*                name = NULL;
    size_t               name_len;
    long                 numkeys    = 0;
    zval*                z_args     = NULL;
    int                  args_count = 0;

    /* Parse parameters */
    if (zend_parse_method_parameters(
            argc, object, "Osl*", &object, ce, &name, &name_len, &numkeys, &z_args, &args_count) ==
        FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        /* Check if name is valid */
        if (!name || name_len <= 0) {
            return 0;
        }

        /* Prepare numkeys as string */
        char numkeys_str[32];
        snprintf(numkeys_str, sizeof(numkeys_str), "%ld", numkeys);

        /* Calculate total arguments: function_name + numkeys + all additional args */
        unsigned long  arg_count = 2 + args_count; /* name + numkeys + additional args */
        uintptr_t*     cmd_args  = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
        unsigned long* args_len  = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));

        if (!cmd_args || !args_len) {
            if (cmd_args)
                efree(cmd_args);
            if (args_len)
                efree(args_len);
            return 0;
        }

        /* Set function name and numkeys */
        cmd_args[0] = (uintptr_t)name;
        args_len[0] = name_len;
        cmd_args[1] = (uintptr_t)numkeys_str;
        args_len[1] = strlen(numkeys_str);

        /* Convert additional arguments to strings if needed */
        int i;
        for (i = 0; i < args_count; i++) {
            zval* arg = &z_args[i];

            /* If not string, convert to one */
            if (Z_TYPE_P(arg) != IS_STRING) {
                zval temp;
                ZVAL_COPY(&temp, arg);
                convert_to_string(&temp);
                cmd_args[i + 2] = (uintptr_t)Z_STRVAL(temp);
                args_len[i + 2] = Z_STRLEN(temp);
                zval_dtor(&temp);
            } else {
                cmd_args[i + 2] = (uintptr_t)Z_STRVAL_P(arg);
                args_len[i + 2] = Z_STRLEN_P(arg);
            }
        }

        /* Execute the command */
        CommandResult* result = execute_command(valkey_glide->glide_client,
                                                FCallReadOnly, /* command type */
                                                arg_count,     /* number of arguments */
                                                cmd_args,      /* arguments */
                                                args_len       /* argument lengths */
        );

        /* Free the argument arrays */
        efree(cmd_args);
        efree(args_len);

        /* Handle the result directly */
        int status = 0;
        if (result) {
            if (result->command_error) {
                /* Command failed */
                free_command_result(result);
                return 0;
            }

            if (result->response) {
                /* FCALL_RO can return various types */
                status = command_response_to_zval(
                    result->response, return_value, COMMAND_RESPONSE_NOT_ASSOSIATIVE, false);
                free_command_result(result);
                return status;
            }
            free_command_result(result);
        }
    }

    return 0;
}

/* Execute a DUMP command using the Valkey Glide client */
int execute_dump_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    char*                key = NULL;
    size_t               key_len;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "Os", &object, ce, &key, &key_len) == FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        core_command_args_t args = {0};
        args.glide_client        = valkey_glide->glide_client;
        args.cmd_type            = Dump;
        args.key                 = key;
        args.key_len             = key_len;

        char*  output     = NULL;
        size_t output_len = 0;
        struct {
            char**  result;
            size_t* result_len;
        } out = {&output, &output_len};

        if (execute_core_command(&args, &out, process_core_string_result)) {
            if (output) {
                /* Return serialized value */
                ZVAL_STRINGL(return_value, output, output_len);
                efree(output);
                return 1;
            } else {
                /* Key doesn't exist */
                ZVAL_FALSE(return_value);
                return 1;
            }
        }
    }

    return 0;
}

/* Execute a RESTORE command using the Valkey Glide client */
int execute_restore_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    char *               key = NULL, *serialized = NULL;
    size_t               key_len, serialized_len;
    long                 ttl;
    zval*                options = NULL;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc,
                                     object,
                                     "Osls|a",
                                     &object,
                                     ce,
                                     &key,
                                     &key_len,
                                     &ttl,
                                     &serialized,
                                     &serialized_len,
                                     &options) == FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        /* Check if key and serialized value are valid */
        if (!key || key_len <= 0 || !serialized || serialized_len <= 0) {
            return 0;
        }

        /* Convert TTL to string */
        char ttl_str[32];
        snprintf(ttl_str, sizeof(ttl_str), "%ld", ttl);

        /* Start with basic arguments: key + ttl + serialized */
        unsigned long  base_arg_count = 3;
        unsigned long  max_args       = 10; /* Maximum possible arguments */
        uintptr_t*     args           = (uintptr_t*)emalloc(max_args * sizeof(uintptr_t));
        unsigned long* args_len       = (unsigned long*)emalloc(max_args * sizeof(unsigned long));

        if (!args || !args_len) {
            if (args)
                efree(args);
            if (args_len)
                efree(args_len);
            return 0;
        }

        /* Set up base arguments */
        args[0]     = (uintptr_t)key;
        args_len[0] = key_len;
        args[1]     = (uintptr_t)ttl_str;
        args_len[1] = strlen(ttl_str);
        args[2]     = (uintptr_t)serialized;
        args_len[2] = serialized_len;

        unsigned long arg_count = base_arg_count;

        /* Process options if provided */
        if (options && Z_TYPE_P(options) == IS_ARRAY) {
            HashTable*   ht = Z_ARRVAL_P(options);
            zval*        val;
            zend_string* key_str;
            zend_ulong   num_key;

            /* Variables for option values */
            zend_bool has_replace = 0;
            zend_bool has_absttl  = 0;
            long      idletime    = -1;
            long      freq        = -1;

            /* Parse the array */
            ZEND_HASH_FOREACH_KEY_VAL(ht, num_key, key_str, val) {
                /* Handle indexed array elements (like ['REPLACE', 'ABSTTL']) */
                if (!key_str && Z_TYPE_P(val) == IS_STRING) {
                    const char* flag = Z_STRVAL_P(val);
                    if (strcmp(flag, "REPLACE") == 0) {
                        has_replace = 1;
                    } else if (strcmp(flag, "ABSTTL") == 0) {
                        has_absttl = 1;
                    }
                }
                /* Handle associative array elements (like ['IDLETIME' => 200]) */
                else if (key_str) {
                    const char* opt_name = ZSTR_VAL(key_str);
                    if (strcmp(opt_name, "REPLACE") == 0) {
                        has_replace = 1;
                    } else if (strcmp(opt_name, "ABSTTL") == 0) {
                        has_absttl = 1;
                    } else if (strcmp(opt_name, "IDLETIME") == 0 && Z_TYPE_P(val) == IS_LONG) {
                        idletime = Z_LVAL_P(val);
                    } else if (strcmp(opt_name, "FREQ") == 0 && Z_TYPE_P(val) == IS_LONG) {
                        freq = Z_LVAL_P(val);
                    }
                }
            }
            ZEND_HASH_FOREACH_END();

            /* Add REPLACE if needed */
            if (has_replace && arg_count < max_args) {
                const char* replace_str = "REPLACE";
                args[arg_count]         = (uintptr_t)replace_str;
                args_len[arg_count]     = strlen(replace_str);
                arg_count++;
            }

            /* Add ABSTTL if needed */
            if (has_absttl && arg_count < max_args) {
                const char* absttl_str = "ABSTTL";
                args[arg_count]        = (uintptr_t)absttl_str;
                args_len[arg_count]    = strlen(absttl_str);
                arg_count++;
            }

            /* Add IDLETIME if provided */
            if (idletime >= 0 && arg_count + 1 < max_args) {
                const char* idletime_str = "IDLETIME";
                args[arg_count]          = (uintptr_t)idletime_str;
                args_len[arg_count]      = strlen(idletime_str);
                arg_count++;

                /* Convert idletime to string */
                char* idletime_val = (char*)emalloc(32);
                snprintf(idletime_val, 32, "%ld", idletime);
                args[arg_count]     = (uintptr_t)idletime_val;
                args_len[arg_count] = strlen(idletime_val);
                arg_count++;
            }

            /* Add FREQ if provided */
            if (freq >= 0 && arg_count + 1 < max_args) {
                const char* freq_str = "FREQ";
                args[arg_count]      = (uintptr_t)freq_str;
                args_len[arg_count]  = strlen(freq_str);
                arg_count++;

                /* Convert freq to string */
                char* freq_val = (char*)emalloc(32);
                snprintf(freq_val, 32, "%ld", freq);
                args[arg_count]     = (uintptr_t)freq_val;
                args_len[arg_count] = strlen(freq_val);
                arg_count++;
            }
        }

        /* Execute the command */
        CommandResult* result = execute_command(valkey_glide->glide_client,
                                                Restore,   /* command type */
                                                arg_count, /* number of arguments */
                                                args,      /* arguments */
                                                args_len   /* argument lengths */
        );

        /* Free any dynamically allocated option values */
        int i;
        for (i = base_arg_count; i < arg_count; i++) {
            /* Check if this is a dynamically allocated string (IDLETIME/FREQ values) */
            char* str = (char*)args[i];
            if (str && str[0] >= '0' && str[0] <= '9') {
                efree(str);
            }
        }

        /* Free the argument arrays */
        efree(args);
        efree(args_len);

        /* Process the result */
        int status = 0;
        if (result) {
            if (result->command_error) {
                /* Command failed */
                free_command_result(result);
                return 0;
            }

            if (result->response) {
                if (result->response->response_type == Ok) {
                    ZVAL_TRUE(return_value);
                    status = 1;
                } else {
                    ZVAL_FALSE(return_value);
                    status = 0;
                }
            }
            free_command_result(result);
        }

        return status;
    }

    return 0;
}

/* Execute a CONFIG command using the Valkey Glide client */
int execute_config_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    char*                operation = NULL;
    size_t               operation_len;
    zval *               key = NULL, *value = NULL;

    /* Parse parameters */
    if (zend_parse_method_parameters(
            argc, object, "Os|z!z!", &object, ce, &operation, &operation_len, &key, &value) ==
        FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);

    /* If we have a Glide client, use it */
    if (valkey_glide->glide_client) {
        /* Check if operation is valid */
        if (!operation) {
            return 0;
        }

        /* Determine the CONFIG operation type */
        enum RequestType command_type;

        if (strncasecmp(operation, "GET", operation_len) == 0) {
            command_type = ConfigGet;
        } else if (strncasecmp(operation, "SET", operation_len) == 0) {
            command_type = ConfigSet;
        } else if (strncasecmp(operation, "RESETSTAT", operation_len) == 0) {
            command_type = ConfigResetStat;
        } else if (strncasecmp(operation, "REWRITE", operation_len) == 0) {
            command_type = ConfigRewrite;
        } else {
            php_error_docref(NULL, E_WARNING, "Unknown CONFIG operation '%s'", operation);
            return 0;
        }

        /* Prepare command arguments */
        unsigned long  arg_count         = 0;
        uintptr_t*     args              = NULL;
        unsigned long* args_len          = NULL;
        char**         temp_strings      = NULL;
        int            temp_string_count = 0;

        /* For CONFIG GET */
        if (command_type == ConfigGet) {
            if (!key) {
                php_error_docref(NULL, E_WARNING, "CONFIG GET requires a parameter");
                return 0;
            }

            /* Handle string or array parameter */
            if (Z_TYPE_P(key) == IS_STRING) {
                arg_count = 1;
                args      = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
                args_len  = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));

                args[0]     = (uintptr_t)Z_STRVAL_P(key);
                args_len[0] = Z_STRLEN_P(key);
            } else if (Z_TYPE_P(key) == IS_ARRAY) {
                HashTable* ht = Z_ARRVAL_P(key);
                arg_count     = zend_hash_num_elements(ht);

                if (arg_count == 0) {
                    php_error_docref(NULL, E_WARNING, "CONFIG GET array cannot be empty");
                    return 0;
                }

                args         = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
                args_len     = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));
                temp_strings = (char**)ecalloc(arg_count, sizeof(char*));

                zval* z_param;
                int   i = 0;
                ZEND_HASH_FOREACH_VAL(ht, z_param) {
                    zval temp;
                    ZVAL_COPY(&temp, z_param);
                    convert_to_string(&temp);

                    temp_strings[temp_string_count] = estrdup(Z_STRVAL(temp));
                    args[i]                         = (uintptr_t)temp_strings[temp_string_count];
                    args_len[i]                     = Z_STRLEN(temp);
                    temp_string_count++;
                    i++;

                    zval_dtor(&temp);
                }
                ZEND_HASH_FOREACH_END();
            } else {
                php_error_docref(NULL, E_WARNING, "CONFIG GET parameter must be a string or array");
                return 0;
            }
        }
        /* For CONFIG SET */
        else if (command_type == ConfigSet) {
            if (!key || (Z_TYPE_P(key) != IS_ARRAY && !value)) {
                php_error_docref(NULL, E_WARNING, "CONFIG SET requires key and value parameters");
                return 0;
            }

            /* Handle two strings or an array */
            if (Z_TYPE_P(key) == IS_STRING && Z_TYPE_P(value) != IS_NULL) {
                /* CONFIG SET key value */
                arg_count    = 2;
                args         = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
                args_len     = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));
                temp_strings = (char**)ecalloc(2, sizeof(char*));

                /* Key */
                args[0]     = (uintptr_t)Z_STRVAL_P(key);
                args_len[0] = Z_STRLEN_P(key);

                /* Value */
                zval temp;
                ZVAL_COPY(&temp, value);
                convert_to_string(&temp);

                temp_strings[0]   = estrdup(Z_STRVAL(temp));
                args[1]           = (uintptr_t)temp_strings[0];
                args_len[1]       = Z_STRLEN(temp);
                temp_string_count = 1;

                zval_dtor(&temp);
            } else if (Z_TYPE_P(key) == IS_ARRAY && value == NULL) {
                /* CONFIG SET from array */
                HashTable* ht = Z_ARRVAL_P(key);
                arg_count     = zend_hash_num_elements(ht) * 2;

                if (arg_count == 0) {
                    php_error_docref(NULL, E_WARNING, "CONFIG SET array cannot be empty");
                    return 0;
                }

                args         = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
                args_len     = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));
                temp_strings = (char**)ecalloc(zend_hash_num_elements(ht), sizeof(char*));

                zend_string* zkey;
                zval*        zvalue;
                int          i = 0;
                ZEND_HASH_FOREACH_STR_KEY_VAL(ht, zkey, zvalue) {
                    if (!zkey) {
                        php_error_docref(NULL, E_WARNING, "CONFIG SET array must be associative");
                        goto cleanup;
                    }

                    /* Add key */
                    args[i]     = (uintptr_t)ZSTR_VAL(zkey);
                    args_len[i] = ZSTR_LEN(zkey);
                    i++;

                    /* Add value */
                    zval temp;
                    ZVAL_COPY(&temp, zvalue);
                    convert_to_string(&temp);

                    temp_strings[temp_string_count] = estrdup(Z_STRVAL(temp));
                    args[i]                         = (uintptr_t)temp_strings[temp_string_count];
                    args_len[i]                     = Z_STRLEN(temp);
                    temp_string_count++;
                    i++;

                    zval_dtor(&temp);
                }
                ZEND_HASH_FOREACH_END();
            } else {
                php_error_docref(NULL, E_WARNING, "CONFIG SET requires two strings or an array");
                return 0;
            }
        }
        /* CONFIG RESETSTAT and CONFIG REWRITE have no additional arguments */
        else if (command_type == ConfigResetStat || command_type == ConfigRewrite) {
            arg_count = 0; /* No arguments needed */
            args      = NULL;
            args_len  = NULL;
        } else {
            php_error_docref(NULL, E_WARNING, "Unknown CONFIG operation '%s'", operation);
            return 0;
        }

        /* Execute the command */
        CommandResult* result =
            execute_command(valkey_glide->glide_client, command_type, arg_count, args, args_len);

        /* Free temporary strings */
        if (temp_strings) {
            for (int i = 0; i < temp_string_count; i++) {
                if (temp_strings[i])
                    efree(temp_strings[i]);
            }
            efree(temp_strings);
        }

        /* Free the argument arrays */
        if (args)
            efree(args);
        if (args_len)
            efree(args_len);

        /* Handle the result */
        int status = 0;
        if (result) {
            if (result->command_error) {
                /* Command failed */
                free_command_result(result);
                return 0;
            }

            if (result->response) {
                if (command_type == ConfigGet) {
                    /* CONFIG GET returns a Map - convert to associative array */
                    status = command_response_to_zval(result->response,
                                                      return_value,
                                                      COMMAND_RESPONSE_ASSOSIATIVE_ARRAY_MAP,
                                                      false);
                } else {
                    /* CONFIG SET/RESETSTAT/REWRITE return OK */
                    if (result->response->response_type == Ok) {
                        ZVAL_TRUE(return_value);
                        status = 1;
                    } else {
                        ZVAL_FALSE(return_value);
                        status = 0;
                    }
                }
            }
            free_command_result(result);
        }

        return status;

    cleanup:
        /* Cleanup on error */
        if (temp_strings) {
            for (int i = 0; i < temp_string_count; i++) {
                if (temp_strings[i])
                    efree(temp_strings[i]);
            }
            efree(temp_strings);
        }
        if (args)
            efree(args);
        if (args_len)
            efree(args_len);
    }

    return 0;
}

/* Execute getReadTimeout command using the Valkey Glide client */
int execute_get_read_timeout_command(const void* glide_client, double* output_value) {
    /* Check if client is valid */
    if (!glide_client || !output_value) {
        return 0;
    }

    /* Since this is a client configuration getter rather than a ValkeyGlide command,
       we'll use a default value as this isn't directly supported by Glide */
    *output_value = 0.0; /* Default read timeout */

    /* Here we'd ideally access the Glide client's configuration, but since
       we don't have direct access to it through the FFI interface, we just
       return success and the default value */

    return 1;
}

/* Unified getReadTimeout command implementation */
int execute_getreadtimeout_command(zval*             object,
                                   int               argc,
                                   zval*             return_value,
                                   zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    double               timeout;

    /* Parse parameters */
    if (zend_parse_method_parameters(argc, object, "O", &object, ce) == FAILURE) {
        return 0;
    }

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);
    if (!valkey_glide || !valkey_glide->glide_client) {
        return 0;
    }

    /* Execute the getReadTimeout command */
    if (execute_get_read_timeout_command(valkey_glide->glide_client, &timeout)) {
        ZVAL_DOUBLE(return_value, timeout);
        return 1;
    }

    return 0;
}

/* Execute getPersistentID command using the Valkey Glide client */
int execute_get_persistent_id_command(const void* glide_client, char** result, size_t* result_len) {
    /* Check if client is valid */
    if (!glide_client || !result || !result_len) {
        return 0;
    }

    /* Since this is a client connection property rather than a ValkeyGlide command,
       we return a NULL value since we don't have access to this information */
    *result     = NULL;
    *result_len = 0;

    return 1;
}

/* Execute a CLIENT command using the Valkey Glide client */
int execute_client_command_internal(
    const void* glide_client, zval* args, int args_count, zval* return_value, zval* route) {
    /* Check if client and args are valid */
    if (!glide_client || !args || args_count <= 0 || !return_value) {
        return 0;
    }

    /* Create argument arrays */
    unsigned long  arg_count = args_count;
    uintptr_t*     cmd_args  = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
    unsigned long* args_len  = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));

    if (!cmd_args || !args_len) {
        if (cmd_args)
            efree(cmd_args);
        if (args_len)
            efree(args_len);
        return 0;
    }

    /* Keep track of allocated strings for cleanup */
    char** allocated     = (char**)emalloc(args_count * sizeof(char*));
    int    allocated_idx = 0;

    /* Convert arguments to strings if needed */
    int i;
    for (i = 0; i < args_count; i++) {
        zval* arg = &args[i];

        /* If string, use directly */
        if (Z_TYPE_P(arg) == IS_STRING) {
            cmd_args[i] = (uintptr_t)Z_STRVAL_P(arg);
            args_len[i] = Z_STRLEN_P(arg);
        } else {
            /* Convert non-string types to string */
            zval   copy;
            size_t str_len;
            char*  str;

            ZVAL_DUP(&copy, arg);
            convert_to_string(&copy);

            str_len = Z_STRLEN(copy);
            str     = emalloc(str_len + 1);
            memcpy(str, Z_STRVAL(copy), str_len);
            str[str_len] = '\0';

            cmd_args[i] = (uintptr_t)str;
            args_len[i] = str_len;

            /* Track allocated string for cleanup */
            allocated[allocated_idx++] = str;

            zval_dtor(&copy);
        }
    }

    /* Determine the appropriate client command type based on the first argument */
    enum RequestType command_type = ClientInfo; /* Default to ClientInfo */

    if (args_count > 0 && Z_TYPE(args[0]) == IS_STRING) {
        const char* subcmd = Z_STRVAL(args[0]);
        if (strcasecmp(subcmd, "KILL") == 0) {
            if (args_count > 1)
                command_type = ClientKill;
            else
                command_type = ClientKillSimple;
        } else if (strcasecmp(subcmd, "LIST") == 0)
            command_type = ClientList;
        else if (strcasecmp(subcmd, "GETNAME") == 0)
            command_type = ClientGetName;
        else if (strcasecmp(subcmd, "ID") == 0)
            command_type = ClientId;
        else if (strcasecmp(subcmd, "SETNAME") == 0)
            command_type = ClientSetName;
        else if (strcasecmp(subcmd, "PAUSE") == 0)
            command_type = ClientPause;
        else if (strcasecmp(subcmd, "UNPAUSE") == 0)
            command_type = ClientUnpause;
        else if (strcasecmp(subcmd, "REPLY") == 0)
            command_type = ClientReply;
        else
            command_type = CustomCommand; /* Use custom command for other subcommands */
    }

    /* Set additional client prefix for custom commands */
    uintptr_t*     final_args      = cmd_args;
    unsigned long* final_args_len  = args_len;
    unsigned long  final_arg_count = arg_count;

    /* If using CustomCommand type, prepend "CLIENT" to the argument list */
    if (command_type == CustomCommand) {
        final_arg_count = arg_count + 1;
        final_args      = (uintptr_t*)emalloc(final_arg_count * sizeof(uintptr_t));
        final_args_len  = (unsigned long*)emalloc(final_arg_count * sizeof(unsigned long));

        if (!final_args || !final_args_len) {
            if (final_args)
                efree(final_args);
            if (final_args_len)
                efree(final_args_len);

            /* Free allocated strings */
            for (i = 0; i < allocated_idx; i++)
                efree(allocated[i]);
            efree(allocated);
            efree(cmd_args);
            efree(args_len);
            return 0;
        }

        /* Add "CLIENT" as first argument */
        final_args[0]     = (uintptr_t)"CLIENT";
        final_args_len[0] = 6; /* strlen("CLIENT") */

        /* Copy the rest of the arguments */
        for (i = 0; i < arg_count; i++) {
            final_args[i + 1]     = cmd_args[i];
            final_args_len[i + 1] = args_len[i];
        }
    }

    /* Execute the command with or without routing */
    CommandResult* result;
    if (route) {
        /* Use cluster routing */
        result = execute_command_with_route(glide_client,
                                            command_type,    /* command type */
                                            final_arg_count, /* number of arguments */
                                            final_args,      /* arguments */
                                            final_args_len,  /* argument lengths */
                                            route            /* route parameter */
        );
    } else {
        /* No routing (standalone mode) */
        result = execute_command(glide_client,
                                 command_type,    /* command type */
                                 final_arg_count, /* number of arguments */
                                 final_args,      /* arguments */
                                 final_args_len   /* argument lengths */
        );
    }

    /* Free allocated memory */
    for (i = 0; i < allocated_idx; i++)
        efree(allocated[i]);
    efree(allocated);

    /* If we created a new args array for CustomCommand, free it */
    if (command_type == CustomCommand) {
        efree(final_args);
        efree(final_args_len);
    }

    efree(cmd_args);
    efree(args_len);

    /* Process the result */
    int status = 0;

    if (result) {
        if (result->command_error) {
            /* Command failed */
            free_command_result(result);
            return 0;
        }

        if (result->response) {
            /* Convert the response to PHP value */
            status = command_response_to_zval(
                result->response, return_value, COMMAND_RESPONSE_NOT_ASSOSIATIVE, false);
        }
        free_command_result(result);
    }

    return status;
}

/* Execute a RAWCOMMAND command using the Valkey Glide client */
int execute_rawcommand_command_internal(
    const void* glide_client, zval* args, int args_count, zval* return_value, zval* route) {
    /* Check if client and args are valid */
    if (!glide_client || !args || args_count <= 0 || !return_value) {
        return 0;
    }

    /* Create argument arrays */
    unsigned long  arg_count = args_count;
    uintptr_t*     cmd_args  = (uintptr_t*)emalloc(arg_count * sizeof(uintptr_t));
    unsigned long* args_len  = (unsigned long*)emalloc(arg_count * sizeof(unsigned long));

    if (!cmd_args || !args_len) {
        if (cmd_args)
            efree(cmd_args);
        if (args_len)
            efree(args_len);
        return 0;
    }

    /* Keep track of allocated strings for cleanup */
    char** allocated     = (char**)emalloc(args_count * sizeof(char*));
    int    allocated_idx = 0;

    /* Convert arguments to strings if needed */
    int i;
    for (i = 0; i < args_count; i++) {
        zval* arg = &args[i];

        /* If string, use directly */
        if (Z_TYPE_P(arg) == IS_STRING) {
            cmd_args[i] = (uintptr_t)Z_STRVAL_P(arg);
            args_len[i] = Z_STRLEN_P(arg);
        } else {
            /* Convert non-string types to string */
            zval   copy;
            size_t str_len;
            char*  str;

            ZVAL_DUP(&copy, arg);
            convert_to_string(&copy);

            str_len = Z_STRLEN(copy);
            str     = emalloc(str_len + 1);
            memcpy(str, Z_STRVAL(copy), str_len);
            str[str_len] = '\0';

            cmd_args[i] = (uintptr_t)str;
            args_len[i] = str_len;

            /* Track allocated string for cleanup */
            allocated[allocated_idx++] = str;

            zval_dtor(&copy);
        }
    }

    /* Execute the command with or without routing */
    CommandResult* result;
    if (route) {
        /* Use cluster routing */
        result = execute_command_with_route(glide_client,
                                            CustomCommand, /* command type for raw commands */
                                            arg_count,     /* number of arguments */
                                            cmd_args,      /* arguments */
                                            args_len,      /* argument lengths */
                                            route          /* route parameter */
        );
    } else {
        /* No routing (standalone mode) */
        result = execute_command(glide_client,
                                 CustomCommand, /* command type for raw commands */
                                 arg_count,     /* number of arguments */
                                 cmd_args,      /* arguments */
                                 args_len       /* argument lengths */
        );
    }

    /* Free allocated memory */
    for (i = 0; i < allocated_idx; i++)
        efree(allocated[i]);
    efree(allocated);
    efree(cmd_args);
    efree(args_len);

    /* Process the result */
    int status = 0;

    if (result) {
        if (result->command_error) {
            /* Command failed */
            free_command_result(result);
            return 0;
        }

        if (result->response) {
            /* Convert the response to PHP value */
            status = command_response_to_zval(
                result->response, return_value, COMMAND_RESPONSE_NOT_ASSOSIATIVE, false);
        }
        free_command_result(result);
    }

    return status;
}

/* Execute a DBSIZE command using the Valkey Glide client - MIGRATED TO CORE FRAMEWORK */
int execute_dbsize_command_internal(const void* glide_client, long* output_value) {
    core_command_args_t args = {0};
    args.glide_client        = glide_client;
    args.cmd_type            = DBSize;

    return execute_core_command(&args, output_value, process_core_int_result);
}

/* Execute client command - UNIFIED IMPLEMENTATION */
int execute_client_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    zval*                z_args     = NULL;
    int                  arg_count  = 0;
    zend_bool            is_cluster = (ce == get_valkey_glide_cluster_ce());
    zval*                route      = NULL;

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);
    if (!valkey_glide || !valkey_glide->glide_client) {
        return 0;
    }

    if (is_cluster) {
        /* Parse parameters for cluster - route + command arguments */
        if (zend_parse_method_parameters(argc, object, "O*", &object, ce, &z_args, &arg_count) ==
            FAILURE) {
            return 0;
        }

        if (arg_count == 0) {
            /* Need at least the route parameter */
            return 0;
        }

        /* First argument is route, rest are command arguments */
        route     = &z_args[0];
        z_args    = &z_args[1];    /* Skip route parameter */
        arg_count = arg_count - 1; /* Reduce count by 1 */

        if (arg_count == 0) {
            /* Need at least one command argument after route */
            return 0;
        }
    } else {
        /* Parse parameters for non-cluster - just command arguments */
        if (zend_parse_method_parameters(argc, object, "O+", &object, ce, &z_args, &arg_count) ==
            FAILURE) {
            return 0;
        }
    }

    /* Execute the client command using the Glide client */
    if (execute_client_command_internal(
            valkey_glide->glide_client, z_args, arg_count, return_value, route)) {
        /* Return value already set in execute_client_command */
        return 1;
    }

    return 0;
}

/* Execute rawcommand command - UNIFIED IMPLEMENTATION */
int execute_rawcommand_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    zval*                z_args     = NULL;
    int                  arg_count  = 0;
    zend_bool            is_cluster = (ce == get_valkey_glide_cluster_ce());
    zval*                route      = NULL;

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);
    if (!valkey_glide || !valkey_glide->glide_client) {
        return 0;
    }

    if (is_cluster) {
        /* Parse parameters for cluster - route + command arguments */
        if (zend_parse_method_parameters(argc, object, "O*", &object, ce, &z_args, &arg_count) ==
            FAILURE) {
            return 0;
        }

        if (arg_count == 0) {
            /* Need at least the route parameter */
            return 0;
        }

        /* First argument is route, rest are command arguments */
        route     = &z_args[0];
        z_args    = &z_args[1];    /* Skip route parameter */
        arg_count = arg_count - 1; /* Reduce count by 1 */

        if (arg_count == 0) {
            /* Need at least one command argument after route */
            return 0;
        }
    } else {
        /* Parse parameters for non-cluster - just command arguments */
        if (zend_parse_method_parameters(argc, object, "O+", &object, ce, &z_args, &arg_count) ==
            FAILURE) {
            return 0;
        }
    }

    /* Execute the raw command using the Glide client */
    if (execute_rawcommand_command_internal(
            valkey_glide->glide_client, z_args, arg_count, return_value, route)) {
        /* Return value already set in execute_rawcommand_command */
        return 1;
    }

    return 0;
}

/* Execute dbSize command - UNIFIED IMPLEMENTATION */
int execute_dbsize_command(zval* object, int argc, zval* return_value, zend_class_entry* ce) {
    valkey_glide_object* valkey_glide;
    zval*                args       = NULL;
    int                  args_count = 0;
    long                 dbsize;
    zend_bool            is_cluster = (ce == get_valkey_glide_cluster_ce());

    /* Get ValkeyGlide object */
    valkey_glide = VALKEY_GLIDE_PHP_ZVAL_GET_OBJECT(valkey_glide_object, object);
    if (!valkey_glide || !valkey_glide->glide_client) {
        return 0;
    }

    /* Setup core command arguments */
    core_command_args_t core_args = {0};
    core_args.glide_client        = valkey_glide->glide_client;
    core_args.cmd_type            = DBSize;
    core_args.is_cluster          = is_cluster;

    if (is_cluster) {
        /* Parse parameters for cluster - route parameter is required */
        if (zend_parse_method_parameters(argc, object, "O*", &object, ce, &args, &args_count) ==
            FAILURE) {
            return 0;
        }

        if (args_count == 0) {
            /* Need the route parameter */
            return 0;
        }

        /* Set up routing */
        core_args.has_route   = 1;
        core_args.route_param = &args[0];
    } else {
        /* Non-cluster case - parse no parameters */
        if (zend_parse_method_parameters(argc, object, "O", &object, ce) == FAILURE) {
            return 0;
        }
    }

    /* Execute using unified core framework */
    if (execute_core_command(&core_args, &dbsize, process_core_int_result)) {
        ZVAL_LONG(return_value, dbsize);
        return 1;
    }

    return 0;
}
