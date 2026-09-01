# Non-blocking backlog

- Map SQLite uniqueness errors to a stable `409 CONFLICT` API envelope.
- Add richer UI query error presentation and archive mutation error notices.
- Consider realpath/symlink defense for static assets if deployment allows untrusted `dist` contents.
- Consider cleanup/reconciliation for orphan output files after a crash between rename and SQLite finalize.
- Add stronger integration coverage for registered output reuse after an actual worker restart.
