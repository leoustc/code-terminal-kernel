.PHONY: build save push clean

build:
	npm run -s compile

save:
	@if [ -z "$(MSG)" ]; then \
		echo "MSG is required. Usage: make save MSG='your message'"; \
		exit 1; \
	fi
	git add -A
	git commit -m "$(MSG)"

push:
	git push

clean:
	rm -rf node_modules out .vscode-test *.vsix *.tsbuildinfo
