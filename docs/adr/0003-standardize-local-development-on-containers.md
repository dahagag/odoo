# Standardize local development on containers

The supported development environment runs Odoo and PostgreSQL in repository-defined Linux containers while bind-mounting the checkout so execution matches the active Git revision. This gives humans and agents one repeatable runtime across host operating systems; host-native Windows setup remains a troubleshooting fallback rather than a second supported environment.
