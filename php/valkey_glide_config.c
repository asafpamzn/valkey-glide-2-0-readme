/* Configuration parsing implementation for ValkeyGlide */

#include "common.h"
#include "zend_API.h"

/* Helper function to get property from PHP object */
static zval *get_object_property(zval *obj, const char *prop_name)
{
    zend_object *zobj = Z_OBJ_P(obj);
    zend_class_entry *ce = zobj->ce;
    zend_property_info *prop_info = zend_hash_str_find_ptr(&ce->properties_info, prop_name, strlen(prop_name));
    if (!prop_info)
    {
        return NULL;
    }
    return OBJ_PROP(zobj, prop_info->offset);
}

/* Parse node address array */
static int parse_addresses(zval *addresses_array, valkey_glide_node_address_t **addresses, int *count)
{
    if (!addresses_array || Z_TYPE_P(addresses_array) != IS_ARRAY)
    {
        *addresses = NULL;
        *count = 0;
        return SUCCESS;
    }

    HashTable *ht = Z_ARRVAL_P(addresses_array);
    *count = zend_hash_num_elements(ht);

    if (*count == 0)
    {
        *addresses = NULL;
        return SUCCESS;
    }

    *addresses = ecalloc(*count, sizeof(valkey_glide_node_address_t));

    int i = 0;
    zval *entry;
    ZEND_HASH_FOREACH_VAL(ht, entry)
    {
        if (Z_TYPE_P(entry) == IS_OBJECT)
        {
            zval *host_prop = get_object_property(entry, "host");
            zval *port_prop = get_object_property(entry, "port");

            if (host_prop && Z_TYPE_P(host_prop) == IS_STRING)
            {
                (*addresses)[i].host = estrdup(Z_STRVAL_P(host_prop));
            }
            else
            {
                (*addresses)[i].host = estrdup("localhost");
            }

            if (port_prop && Z_TYPE_P(port_prop) == IS_LONG)
            {
                (*addresses)[i].port = (int)Z_LVAL_P(port_prop);
            }
            else
            {
                (*addresses)[i].port = 6379;
            }
        }
        i++;
    }
    ZEND_HASH_FOREACH_END();

    return SUCCESS;
}

/* Parse server credentials */
static int parse_credentials(zval *creds_obj, valkey_glide_server_credentials_t **credentials)
{
    if (!creds_obj || Z_TYPE_P(creds_obj) != IS_OBJECT)
    {
        *credentials = NULL;
        return SUCCESS;
    }

    *credentials = ecalloc(1, sizeof(valkey_glide_server_credentials_t));

    zval *password_prop = get_object_property(creds_obj, "password");
    zval *username_prop = get_object_property(creds_obj, "username");

    if (password_prop && Z_TYPE_P(password_prop) == IS_STRING)
    {
        (*credentials)->password = estrdup(Z_STRVAL_P(password_prop));
    }

    if (username_prop && Z_TYPE_P(username_prop) == IS_STRING)
    {
        (*credentials)->username = estrdup(Z_STRVAL_P(username_prop));
    }

    return SUCCESS;
}

/* Parse backoff strategy */
static int parse_backoff_strategy(zval *backoff_obj, valkey_glide_backoff_strategy_t **strategy)
{
    if (!backoff_obj || Z_TYPE_P(backoff_obj) != IS_OBJECT)
    {
        *strategy = NULL;
        return SUCCESS;
    }

    *strategy = ecalloc(1, sizeof(valkey_glide_backoff_strategy_t));

    zval *retries_prop = get_object_property(backoff_obj, "num_of_retries");
    zval *factor_prop = get_object_property(backoff_obj, "factor");
    zval *base_prop = get_object_property(backoff_obj, "exponent_base");
    zval *jitter_prop = get_object_property(backoff_obj, "jitter_percent");

    if (retries_prop && Z_TYPE_P(retries_prop) == IS_LONG)
    {
        (*strategy)->num_of_retries = (int)Z_LVAL_P(retries_prop);
    }

    if (factor_prop && Z_TYPE_P(factor_prop) == IS_LONG)
    {
        (*strategy)->factor = (int)Z_LVAL_P(factor_prop);
    }

    if (base_prop && Z_TYPE_P(base_prop) == IS_LONG)
    {
        (*strategy)->exponent_base = (int)Z_LVAL_P(base_prop);
    }

    if (jitter_prop && Z_TYPE_P(jitter_prop) == IS_LONG)
    {
        (*strategy)->jitter_percent = (int)Z_LVAL_P(jitter_prop);
    }
    else
    {
        (*strategy)->jitter_percent = -1;
    }

    return SUCCESS;
}

/* Parse advanced configuration */
static int parse_advanced_config(zval *advanced_obj, valkey_glide_advanced_base_client_configuration_t **advanced_config)
{
    if (!advanced_obj || Z_TYPE_P(advanced_obj) != IS_OBJECT)
    {
        *advanced_config = NULL;
        return SUCCESS;
    }

    *advanced_config = ecalloc(1, sizeof(valkey_glide_advanced_base_client_configuration_t));

    zval *timeout_prop = get_object_property(advanced_obj, "connection_timeout");
    zval *tls_prop = get_object_property(advanced_obj, "tls_config");

    if (timeout_prop && Z_TYPE_P(timeout_prop) == IS_LONG)
    {
        (*advanced_config)->connection_timeout = (int)Z_LVAL_P(timeout_prop);
    }
    else
    {
        (*advanced_config)->connection_timeout = -1;
    }

    if (tls_prop && Z_TYPE_P(tls_prop) == IS_OBJECT)
    {
        (*advanced_config)->tls_config = ecalloc(1, sizeof(valkey_glide_tls_advanced_configuration_t));
        zval *insecure_prop = get_object_property(tls_prop, "use_insecure_tls");
        if (insecure_prop && Z_TYPE_P(insecure_prop) == IS_TRUE)
        {
            (*advanced_config)->tls_config->use_insecure_tls = true;
        }
    }

    return SUCCESS;
}

/* Parse base client configuration */
static int parse_base_configuration(zval *config_obj, valkey_glide_base_client_configuration_t *base_config)
{
    zval *prop;

    /* Parse addresses */
    prop = get_object_property(config_obj, "addresses");
    if (parse_addresses(prop, &base_config->addresses, &base_config->addresses_count) != SUCCESS)
    {
        return FAILURE;
    }

    /* Parse use_tls */
    prop = get_object_property(config_obj, "use_tls");
    base_config->use_tls = (prop && Z_TYPE_P(prop) == IS_TRUE);

    /* Parse credentials */
    prop = get_object_property(config_obj, "credentials");
    if (parse_credentials(prop, &base_config->credentials) != SUCCESS)
    {
        return FAILURE;
    }

    /* Parse read_from */
    prop = get_object_property(config_obj, "read_from");
    if (prop && Z_TYPE_P(prop) == IS_LONG)
    {
        base_config->read_from = (valkey_glide_read_from_t)Z_LVAL_P(prop);
    }
    else
    {
        base_config->read_from = VALKEY_GLIDE_READ_FROM_PRIMARY;
    }

    /* Parse request_timeout */
    prop = get_object_property(config_obj, "request_timeout");
    if (prop && Z_TYPE_P(prop) == IS_LONG)
    {
        base_config->request_timeout = (int)Z_LVAL_P(prop);
    }
    else
    {
        base_config->request_timeout = -1;
    }

    /* Parse reconnect_strategy */
    prop = get_object_property(config_obj, "reconnect_strategy");
    if (parse_backoff_strategy(prop, &base_config->reconnect_strategy) != SUCCESS)
    {
        return FAILURE;
    }

    /* Parse client_name */
    prop = get_object_property(config_obj, "client_name");
    if (prop && Z_TYPE_P(prop) == IS_STRING)
    {
        base_config->client_name = estrdup(Z_STRVAL_P(prop));
    }

    /* Parse protocol */
    prop = get_object_property(config_obj, "protocol");
    if (prop && Z_TYPE_P(prop) == IS_LONG)
    {
        base_config->protocol = (valkey_glide_protocol_version_t)Z_LVAL_P(prop);
    }
    else
    {
        base_config->protocol = VALKEY_GLIDE_PROTOCOL_RESP3;
    }

    /* Parse inflight_requests_limit */
    prop = get_object_property(config_obj, "inflight_requests_limit");
    if (prop && Z_TYPE_P(prop) == IS_LONG)
    {
        base_config->inflight_requests_limit = (int)Z_LVAL_P(prop);
    }
    else
    {
        base_config->inflight_requests_limit = -1;
    }

    /* Parse client_az */
    prop = get_object_property(config_obj, "client_az");
    if (prop && Z_TYPE_P(prop) == IS_STRING)
    {
        base_config->client_az = estrdup(Z_STRVAL_P(prop));
    }

    /* Parse advanced_config */
    prop = get_object_property(config_obj, "advanced_config");
    if (parse_advanced_config(prop, &base_config->advanced_config) != SUCCESS)
    {
        return FAILURE;
    }

    /* Parse lazy_connect */
    prop = get_object_property(config_obj, "lazy_connect");
    base_config->lazy_connect = (prop && Z_TYPE_P(prop) == IS_TRUE);

    return SUCCESS;
}

/* Parse client configuration */
int parse_valkey_glide_client_configuration(zval *config_obj, valkey_glide_client_configuration_t *config)
{
    if (!config_obj || Z_TYPE_P(config_obj) != IS_OBJECT)
    {
        return FAILURE;
    }

    /* Parse base configuration */
    if (parse_base_configuration(config_obj, &config->base) != SUCCESS)
    {
        return FAILURE;
    }

    /* Parse database_id */
    zval *db_prop = get_object_property(config_obj, "database_id");
    if (db_prop && Z_TYPE_P(db_prop) == IS_LONG)
    {
        config->database_id = (int)Z_LVAL_P(db_prop);
    }
    else
    {
        config->database_id = -1;
    }

    return SUCCESS;
}

/* Parse cluster client configuration */
int parse_valkey_glide_cluster_client_configuration(zval *config_obj, valkey_glide_cluster_client_configuration_t *config)
{
    if (!config_obj || Z_TYPE_P(config_obj) != IS_OBJECT)
    {
        return FAILURE;
    }

    /* Parse base configuration */
    if (parse_base_configuration(config_obj, &config->base) != SUCCESS)
    {
        return FAILURE;
    }

    /* Parse periodic_checks */
    zval *checks_prop = get_object_property(config_obj, "periodic_checks");
    if (checks_prop)
    {
        if (Z_TYPE_P(checks_prop) == IS_LONG)
        {
            config->periodic_checks_status = (valkey_glide_periodic_checks_status_t)Z_LVAL_P(checks_prop);
            config->periodic_checks_manual = NULL;
        }
        else if (Z_TYPE_P(checks_prop) == IS_OBJECT)
        {
            config->periodic_checks_manual = ecalloc(1, sizeof(valkey_glide_periodic_checks_manual_interval_t));
            zval *duration_prop = get_object_property(checks_prop, "duration_in_sec");
            if (duration_prop && Z_TYPE_P(duration_prop) == IS_LONG)
            {
                config->periodic_checks_manual->duration_in_sec = (int)Z_LVAL_P(duration_prop);
            }
        }
    }
    else
    {
        config->periodic_checks_status = VALKEY_GLIDE_PERIODIC_CHECKS_ENABLED_DEFAULT;
        config->periodic_checks_manual = NULL;
    }

    return SUCCESS;
}

/* Free base configuration */
static void free_base_configuration(valkey_glide_base_client_configuration_t *base_config)
{
    if (base_config->addresses)
    {
        for (int i = 0; i < base_config->addresses_count; i++)
        {
            if (base_config->addresses[i].host)
            {
                efree(base_config->addresses[i].host);
            }
        }
        efree(base_config->addresses);
    }

    if (base_config->credentials)
    {
        if (base_config->credentials->password)
        {
            efree(base_config->credentials->password);
        }
        if (base_config->credentials->username)
        {
            efree(base_config->credentials->username);
        }
        efree(base_config->credentials);
    }

    if (base_config->reconnect_strategy)
    {
        efree(base_config->reconnect_strategy);
    }

    if (base_config->client_name)
    {
        efree(base_config->client_name);
    }

    if (base_config->client_az)
    {
        efree(base_config->client_az);
    }

    if (base_config->advanced_config)
    {
        if (base_config->advanced_config->tls_config)
        {
            efree(base_config->advanced_config->tls_config);
        }
        efree(base_config->advanced_config);
    }
}

/* Free client configuration */
void free_valkey_glide_client_configuration(valkey_glide_client_configuration_t *config)
{
    free_base_configuration(&config->base);
}

/* Free cluster client configuration */
void free_valkey_glide_cluster_client_configuration(valkey_glide_cluster_client_configuration_t *config)
{
    free_base_configuration(&config->base);

    if (config->periodic_checks_manual)
    {
        efree(config->periodic_checks_manual);
    }
}
