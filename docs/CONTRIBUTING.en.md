# Contribution guide

## Creating a PR
Thank you for your PR! Before creating a PR, please check the following:
- If possible, prefix the title with a keyword that identifies the type of this PR, as shown below.
  - fix / refactor / feat / enhance / perf / chore etc.
  - Also, make sure that the granularity of this PR is appropriate. Please do not include more than one type of change or interest in a single PR.
- If there is an Issue which will be resolved by this PR, please include a reference to the Issue in the text.
- Please add the summary of the changes to CHANGELOG.md. However, this is not necessary for changes that do not affect the users, such as refactoring.
- Check if there are any documents that need to be created or updated due to this change.
- If you have added a feature or fixed a bug, please add a test case if possible.
- Please make sure that tests and Lint are passed in advance.
  - You can run it with `npm run test` and `npm run lint`.
- Run `npm run api` to update the API report and commit it if there are any diffs.
Thanks for your cooperation 🤗

**ℹ️ Important:** If your language is not Japanese, you do not need to translate and write the description in Japanese.
The accuracy of translation into Japanese is not high, so it will be easier for us to understand if you write it in the original language.
It will also allow the reader to use the translation tool of their preference if necessary.
