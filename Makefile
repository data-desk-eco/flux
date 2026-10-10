.PHONY: serve test audit dist review-deploy deploy-private vendor help

# the etl that publishes everything this map reads. only the private bake
# below reads it directly; the public site reads the archive
ETL ?= $(HOME)/data-desk/etl
ARCHIVE = https://s3.WAW3-2.cloudferro.com/data-desk-archive

vendor: web/vendor/.ok

web/vendor/.ok:
	@bash scripts/vendor.sh
	@touch web/vendor/.ok

serve: vendor
	@python3 scripts/serve.py 8000 web

# exactly what the pages workflow runs, assertions and all: the public build
# proves it carries no licensed row, so run it before pushing
dist:
	@bash scripts/dist.sh $$(git rev-parse HEAD)

# the review api, worker/review.js, and its d1 table of verdicts
review-deploy:
	cd worker && npx wrangler d1 execute flux-review --remote \
	  --file schema.sql && npx wrangler deploy

# the access-gated deploy. it bakes every provider's plumes, ghgsat's
# licensed ones among them, and mapstand's licence acreage, so it refuses to
# run unless the gate is answering. the data desk plumes come off the
# archive: their rebuild is a campaign, never a deploy
PLUMES = $(foreach p,carbon-mapper sron imeo,\
	'$(ETL)/data/$(p)/detections/**/data.parquet',) \
	'$(ARCHIVE)/data-desk/detections/data.parquet', \
	'$(ETL)/data/ghgsat/private/detections/**/data.parquet'
deploy-private:
	@curl -so /dev/null -w '%{redirect_url}' https://flux-private.pages.dev \
	  | grep -q cloudflareaccess.com \
	  || { echo "access gate is down: refusing to deploy"; exit 1; }
	$(MAKE) -C $(ETL) carbon-mapper sron imeo ghgsat
	@mkdir -p web/data
	duckdb -c "COPY (FROM read_parquet([$(PLUMES)], union_by_name=true) \
	  WHERE kind = 'plume') TO 'web/data/plumes.parquet' \
	  (FORMAT PARQUET, COMPRESSION ZSTD)"
	cp $(ETL)/data/mapstand/private/licences/data.parquet \
	  web/data/licences.parquet
	bash scripts/dist.sh $$(git rev-parse HEAD) local
	npx wrangler pages deploy dist --project-name flux-private --branch main

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
	@echo "make deploy-private - the ghgsat + mapstand bake, behind Access"
