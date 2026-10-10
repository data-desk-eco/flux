.PHONY: serve test audit dist review-deploy vendor help

vendor: web/vendor/.ok

web/vendor/.ok:
	@bash scripts/vendor.sh
	@touch web/vendor/.ok

serve: vendor
	@python3 scripts/serve.py 8000 web

# exactly what the pages workflow runs, assertions and all
dist:
	@bash scripts/dist.sh $$(git rev-parse HEAD)

# the review api, worker/review.js, and its d1 table of verdicts
review-deploy:
	cd worker && npx wrangler d1 execute flux-review --remote \
	  --file schema.sql && npx wrangler deploy

# the reducer and the two feature builders, where every persistence incident
# this repo records has happened
test:
	@node --test test/*.test.mjs

# the page against the brand guidelines, through vendor/dd/audit.js: any
# deviation not declared in config.audit (layers.js AUDIT) fails it
audit:
	@bash scripts/audit.sh

help:
	@echo "make serve          - dev server on :8000"
	@echo "make test           - the flaring rate rules, in node"
	@echo "make audit          - the ui against the dd brand, headless"
	@echo "make vendor         - re-vendor maplibre, duckdb, dd and inter"
	@echo "make dist           - the public artifact in dist/, as Actions"
