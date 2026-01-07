.PHONY: save push tag package clean

NODE_BIN := ./node_modules/.bin
TSC := $(NODE_BIN)/tsc
VSCE := $(NODE_BIN)/vsce
VERSION_FILE := VERSION
PKG_JSON := package.json
TAG ?= v$(shell cat $(VERSION_FILE))
BRANCH ?= main
OUT_DIR ?= $(CURDIR)

save:
	git add -A
	@if [ -n "$(MSG)" ]; then \
		git commit -m "$(MSG)"; \
	else \
		git commit; \
	fi

push:
	git push --force origin "$(BRANCH)"

tag:
	@if [ -z "$(TAG)" ]; then \
		echo "TAG is empty"; \
		exit 1; \
	fi
	@if git rev-parse -q --verify "refs/tags/$(TAG)" >/dev/null; then \
		echo "Tag exists: $(TAG)"; \
		exit 1; \
	fi
	@if git ls-remote --tags origin "refs/tags/$(TAG)" | grep -q "$(TAG)"; then \
		echo "Remote tag exists: $(TAG)"; \
		exit 1; \
	fi
	git add -A
	@if git diff --cached --quiet; then \
		echo "No changes to commit."; \
	else \
		git commit -m "$(TAG)"; \
	fi
	git tag -a "$(TAG)" -m "$(TAG)"
	git push origin "$(BRANCH)"
	git push origin "$(TAG)"

package:
	@if [ ! -x "$(TSC)" ]; then \
		echo "TypeScript not installed. Run: npm install"; \
		exit 1; \
	fi
	@if [ ! -x "$(VSCE)" ]; then \
		echo "vsce not installed. Run: npm install"; \
		exit 1; \
	fi
	$(TSC) -p ./
	@out_dir="$(OUT_DIR)"; \
	base=$$(node -e "const pkg=require('./$(PKG_JSON)'); console.log(pkg.name + '-' + pkg.version + '.vsix');"); \
	vsix="$$out_dir/$$base"; \
	$(VSCE) package -o "$$vsix"; \
	echo "$$vsix"

clean:
	rm -rf node_modules out .vscode-test *.vsix *.tsbuildinfo
