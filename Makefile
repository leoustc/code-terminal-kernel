.PHONY: build save push clean package sync tag release

NODE_BIN := ./node_modules/.bin
TSC := $(NODE_BIN)/tsc
VSCE := $(NODE_BIN)/vsce
NAME_FILE := NAME
VERSION_FILE := VERSION
PKG_JSON := package.json
TAG ?= v$(shell cat $(VERSION_FILE))
BRANCH ?= main

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
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Working tree is not clean. Run: make save (or stash)"; \
		exit 1; \
	fi
	git pull --rebase origin "$(BRANCH)"
	git push --follow-tags origin "$(BRANCH)"

tag:
	@if [ -z "$(TAG)" ]; then \
		echo "TAG is empty"; \
		exit 1; \
	fi
	@if git rev-parse -q --verify "refs/tags/$(TAG)" >/dev/null; then \
		git tag -d "$(TAG)"; \
	fi
	git tag -a "$(TAG)" -m "$(TAG)"
	@if git ls-remote --tags origin "refs/tags/$(TAG)" | grep -q "$(TAG)"; then \
		git push --delete origin "$(TAG)"; \
	fi
	git push origin "$(TAG)"

release: sync
	@if [ -z "$(TAG)" ]; then \
		echo "TAG is empty"; \
		exit 1; \
	fi
	@current=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$current" = "HEAD" ]; then \
		git checkout -B "$(BRANCH)"; \
	fi
	git add -A
	@if git diff --cached --quiet; then \
		echo "No changes to commit."; \
	else \
		git commit -m "$(TAG)"; \
	fi
	@if git rev-parse -q --verify "refs/tags/$(TAG)" >/dev/null; then \
		git tag -d "$(TAG)"; \
	fi
	git tag -a "$(TAG)" -m "$(TAG)"
	@if git ls-remote --tags origin "refs/tags/$(TAG)" | grep -q "$(TAG)"; then \
		git push --delete origin "$(TAG)"; \
	fi
	git push --force-with-lease origin "$(BRANCH)"
	git push --force origin "$(TAG)"

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
