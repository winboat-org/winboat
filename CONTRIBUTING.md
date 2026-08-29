# WinBoat Contribution Guidelines

This document outlines the general contribution guidelines that apply to WinBoat.

> [!TIP]
> If you're new to open source, the [Open Source Etiquette](https://developer.mozilla.org/en-US/docs/MDN/Community/Open_source_etiquette) is an excellent read that you should check out before reading the rest of this document.

> [!IMPORTANT]
> Basic familiarity with Git and GitHub is required: If you are also new to these tools, visit [GitHub for complete beginners](https://github.com/git-guides#learning-git-basics) for a comprehensive introduction to them.

## General

1. **Avoid vibe-coding large features** - While probably most of us use AI while coding in our day to day lives, you should try to use it in a clever and targeted manner. Avoid submitting large vibe-coded features, because in 99% of the cases they will not behave as expected. These kinds of PR-s drain our energy and time that could be focused on something more useful, because what took a few seconds for the AI assistant to pump out will take us hours to test, discuss, and ultimately scrap because it doesn't take into account half the things a real programmer probably would. If you made heavy use of AI in your pull request, **indicate it**.

2. **Do not break existing code** - WinBoat aims to provide a seamless user experience, so please avoid the breakage of any existing features to the best of your abilities. Ensure that folks potentially upgrading to a new version that includes your changes won't have any problems, and address any migrations if they're required.

3. **Do rigorous testing** - WinBoat is used by tens of thousands of folks every day on a wide range of Linux distros, make sure that the PR you submit doesn't break compatibility on any of the mainstream distros.

4. **If you're unsure, ask** - If you want to start working on something large that you then intend for us to merge into WinBoat, it may be worth asking us first in an issue to understand if the feature is compatible with the philosophy of WinBoat and whether we want to include it. The same idea applies if you're unsure how to implement a feature in a way that's compatible with how WinBoat operates.

5. **Avoid introducing new programming languages** - WinBoat uses TypeScript & Vue for the Electron app, and Go & PowerShell for the Guest Server. Use these for getting things done.

6. **Avoid introducing new foreign dependencies** - Chances are there's an NPM / Go package for what you're trying to achieve or at least something similar. If there isn't, and it's a must to include it, discuss with us first.

## Branch Management

Before contributing, you should always create a personal fork of WinBoat, where you can create a dedicated branch for the changes you're aiming to make. Once you're finished with your changes, you can go ahead and create a PR aiming to merge your changes to WinBoat's main branch. If you're still in the process of development, but you'd still like to open a PR for visibility or discussion, make sure that you open a draft PR instead.

**Branch naming convention:** Use descriptive names like `feat/your-feature-name` or `fix/issue-description`

## Pull Requests & Commits

Your PR title should include what it's trying to do, e.g. `feat: Add VNC port into Configuration`, while the description should outline it in more detail, potentially explaining how the feature works, details on the implementation, and/or why the feature is useful.

Make sure you reference any issues that are potentially linked to your Pull Request using GitHub's [keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue), either via comments or commit messages.

WinBoat generally uses the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) naming scheme. You should aim to stick to these conventions whenever possible.

## Review & Merging Process

After you've submitted your changes as a PR, a maintainer may request changes to your code before merging. If everything goes well, your PR will be merged and shipped in the next version of WinBoat.

In case we find issues later on, the PR commits might be reverted and additional discussion will take place in the PR thread or a separate issue.
