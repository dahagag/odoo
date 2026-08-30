# Split agent control from native execution

External agents inspect state, plan work, obtain required approval, and invoke narrow commands through least-privilege Odoo interfaces. Durable mutations run inside owned Odoo code so ORM security, transactions, batching, locking, retries, and audit behavior remain authoritative; development autonomy and live administrative authority use separate identities and trust boundaries.
