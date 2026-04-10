# jumpcloud-docs-public

## About

This repository is used to host the [JumpCloud API Documentation Website](https://docs.jumpcloud.com) for public distribution. This repository leverages [GitHub Pages](https://pages.github.com/) for hosting.

## Source and updates

Most of the site under `docs/` is **built in the [jumpcloud-docs](https://github.com/TheJumpCloud/jumpcloud-docs) repository** and pushed here by CI (the “Build External Docs” workflow: build with `build_docs.py`, then `rsync` into `docs/` on this repo). That merge is non-destructive: files that exist only in this repository—such as `CNAME`, `404.html`, `images/`, and hand-maintained pages like `docs/api/index.html`—are left in place when they are not part of the build output.

To change generated API documentation, open a pull request against **jumpcloud-docs**, not this repository.
