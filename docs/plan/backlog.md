# Non-blocking backlog

- Map SQLite uniqueness errors to a stable `409 CONFLICT` API envelope.
- Add richer UI query error presentation and archive mutation error notices.
- Consider realpath/symlink defense for static assets if deployment allows untrusted `dist` contents.
- Consider cleanup/reconciliation for orphan output files after a crash between rename and SQLite finalize.
- Add stronger integration coverage for registered output reuse after an actual worker restart.
- Deduplicate image materials by content hash so reusing the same generated result twice does not create a second upload row.
- Give the prompt composer an inline token editor; reuse currently restores tokens as plain text in the textarea.
