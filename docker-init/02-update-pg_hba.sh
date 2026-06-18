#!/bin/bash
# Add tradebot user to allow all connections
echo "host    all             tradebot        all             trust" >> /var/lib/postgresql/data/pg_hba.conf
# Reload config
psql -U postgres -c "SELECT pg_reload_conf();"
