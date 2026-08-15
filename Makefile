.PHONY: serve signal test dist deploy-private signal-deploy terminals vendor help

# the plume etl (carbon mapper / imeo / sron / ghgsat) lives in ~/Tools/etl; the
# public site reads one detections object per provider live, and only the
# private bake below writes a parquet of its own
ETL ?= $(HOME)/Tools/etl

terminals: web/terminals.geojson

# gem's prelude flng row (T100000130339) is ~165 km sse of the vessel's true mooring
# despite claiming "exact" accuracy; override with the vnf-derived flare position
web/terminals.geojson: data/GEM-GGIT-LNG-Teminals-2025-09.xlsx
	@duckdb -c "\
	COPY ( \
	  SELECT json_object( \
	    'type', 'FeatureCollection', \
	    'features', json_group_array(json_object( \
	      'type', 'Feature', \
	      'geometry', json_object( \
	        'type', 'Point', \
	        'coordinates', CASE ProjectID WHEN 'T100000130339' THEN json_array(123.3158, -13.7847) \
	          ELSE json_array(CAST(Longitude AS DOUBLE), CAST(Latitude AS DOUBLE)) END \
	      ), \
	      'properties', json_object( \
	        'name', TerminalName, \
	        'country', \"Country/Area\", \
	        'type', FacilityType, \
	        'status', Status, \
	        'capacity_mtpa', CAST(CapacityinMtpa AS DOUBLE), \
	        'owner', Owner \
	      ) \
	    )) \
	  ) \
	  FROM read_xlsx('data/GEM-GGIT-LNG-Teminals-2025-09.xlsx', sheet='LNG Terminals', header=true, all_varchar=true) \
	  WHERE Status IN ('operating', 'construction', 'idled', 'mothballed') \
	    AND Latitude IS NOT NULL AND Longitude IS NOT NULL \
	    AND CAST(Latitude AS DOUBLE) BETWEEN -90 AND 90 \
	    AND CAST(Longitude AS DOUBLE) BETWEEN -180 AND 180 \
	) TO 'web/terminals.geojson' (FORMAT CSV, HEADER false, QUOTE '', DELIMITER '');"
	@echo "web/terminals.geojson: $$(python3 -c "import json; print(len(json.load(open('web/terminals.geojson'))['features']))" 2>/dev/null) features"

# the etl that publishes what this map reads lives in ~/Tools/etl: the eog
# provider builds eog/flares, eog/detections and eog/observations; data-desk
# builds the sentinel-2 pair. nothing here reads the archive.

vendor: web/vendor/.ok

web/vendor/.ok:
	@bash scripts/vendor.sh
	@touch web/vendor/.ok

serve: vendor signal
	@echo "http://localhost:8000  (signaling on :4444)"
	@python3 scripts/serve.py 8000 web

signal:
	@node signal/server.js &

# exactly what the pages workflow runs, assertions and all — the public build
# proves it carries no licensed row, so run it here before pushing rather than
# discovering it in Actions
dist:
	@bash scripts/dist.sh $$(git rev-parse HEAD)

# datadesk-only deploy (cloudflare pages behind access). bakes an etl-built
# plumes.parquet — including local-only ghgsat and our own dd detections — so it
# refuses to deploy unless the access gate is answering
deploy-private:
	@curl -so /dev/null -w '%{redirect_url}' https://flux-private.pages.dev | grep -q cloudflareaccess.com || { echo "access gate is down — refusing to deploy"; exit 1; }
	$(MAKE) -C $(ETL) carbon-mapper sron imeo ghgsat
	@mkdir -p web/data
# s2e-views is not in that list and the data desk plumes come off the archive
# instead. detection is a campaign rather than a schedule, so the view rebuild is
# deliberate too — and it writes the flare half in the same wholesale replacement,
# which no deploy should be triggering. the published object is the same rows.
	duckdb -c "COPY (FROM read_parquet(['$(ETL)/data/carbon-mapper/detections/**/data.parquet','$(ETL)/data/sron/detections/**/data.parquet','$(ETL)/data/imeo/detections/**/data.parquet','https://s3.WAW3-2.cloudferro.com/data-desk-archive/data-desk/detections/data.parquet','$(ETL)/data/ghgsat/private/detections/**/data.parquet'], union_by_name=true) WHERE kind = 'plume') TO 'web/data/plumes.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)"
# the licence acreage is a restricted source and its sweep goes down. there is
# no tolerant path any more: dist.sh refuses a local build missing either bake,
# because a private deploy that is quietly the public map is the harder failure
# to notice than one that stops here.
	cp $(ETL)/data/mapstand/private/licences/data.parquet web/data/licences.parquet
	bash scripts/dist.sh $$(git rev-parse HEAD) local
	npx wrangler pages deploy dist --project-name flux-private --branch main

# the webrtc mesh's rendezvous, and the only deploy here that is not the map.
# readers on every origin share one room, so redeploying drops live peers
# mid-sync — it is not part of a release. run it when signal/ itself changes,
# and not otherwise.
signal-deploy:
	npx wrangler deploy

test:
	@node --test test/determinism.test.mjs test/retry-peers.test.mjs

help:
	@echo "make serve          - Dev server on :8000 + signaling on :4444"
	@echo "make signal         - Signaling server only"
	@echo "make vendor         - Vendor dependencies via cartograph + the s2e wasm core"
	@echo "make test           - Run determinism tests"
	@echo "make dist           - Build the public artifact into dist/ (what Actions publishes)"
	@echo "make deploy-private - Build with the ghgsat + mapstand bakes, deploy behind Access"
	@echo "make signal-deploy  - Redeploy the signaling worker (drops live peers)"
