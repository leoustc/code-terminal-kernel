.PHONY: build save push clean package sync tag release

NODE_BIN := ./node_modules/.bin
TSC := $(NODE_BIN)/tsc
VSCE := $(NODE_BIN)/vsce
NAME_FILE := NAME
VERSION_FILE := VERSION
PKG_JSON := package.json
TAG ?= v$(shell cat $(VERSION_FILE))

build: npm sync
	@if [ ! -x "$(TSC)" ]; then \
		echo "TypeScript not installed. Run: npm install"; \
		exit 1; \
	fi
	$(TSC) -p ./

save:
	git add -A
	@if [ -z "$(MSG)" ]; then \
		git commit --amend --no-edit; \
	else \
		git commit -m "$(MSG)"; \
	fi

push:
	git push --follow-tags

tag:
	@if [ -z "$(TAG)" ]; then \
		echo "TAG is empty"; \
		exit 1; \
	fi
	git tag -a "$(TAG)" -m "$(TAG)"

release: sync
	@if [ -z "$(TAG)" ]; then \
		echo "TAG is empty"; \
		exit 1; \
	fi
	git add -A
	@if git diff --cached --quiet; then \
		echo "No changes to commit."; \
	else \
		git commit -m "$(TAG)"; \
	fi
	git tag -a "$(TAG)" -m "$(TAG)"
	git push --follow-tags

clean:
	rm -rf node_modules out .vscode-test *.vsix *.tsbuildinfo

package: npm sync build
	@if [ ! -x "$(VSCE)" ]; then \
		echo "vsce not installed. Run: npm install"; \
		exit 1; \
	fi
	$(VSCE) package
	@name=$$(cat $(NAME_FILE)); version=$$(cat $(VERSION_FILE)); \
	vsix="$(CURDIR)/$${name}-$${version}.vsix"; \
	if [ -f "$$vsix" ]; then \
		echo "$$vsix"; \
	else \
		echo "VSIX not found: $$vsix"; \
		exit 1; \
	fi

npm:
	@npm install

sync:
	@if [ ! -f "$(NAME_FILE)" ]; then \
		echo "Missing $(NAME_FILE)"; \
		exit 1; \
	fi
	@if [ ! -f "$(VERSION_FILE)" ]; then \
		echo "Missing $(VERSION_FILE)"; \
		exit 1; \
	fi
	@node -e "const fs=require('fs'); const name=fs.readFileSync('$(NAME_FILE)','utf8').trim(); const version=fs.readFileSync('$(VERSION_FILE)','utf8').trim(); const path='$(PKG_JSON)'; const pkg=JSON.parse(fs.readFileSync(path,'utf8')); let changed=false; if (pkg.name!==name) { pkg.name=name; changed=true; } if (pkg.version!==version) { pkg.version=version; changed=true; } if (changed) { fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n'); }"
