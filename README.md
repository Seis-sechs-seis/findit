# FindIt

Express + EJS lost-and-found web app.

```text
server.js
src/
  app.js
  db/
    models/
    sql/
  http/
    controllers/
    middleware/
    routes/
    services/
    utils/
  services/
  styles/
    global.css
  utils/
views/
  partials/
    home/
      stats-grid.ejs
      stats-hero-rail.ejs
    thread/
      feed.ejs
      msg-attachment.ejs
      msg-rich-inline.ejs
      msg-stamp.ejs
      phase-divider.ejs
      phase-pairs.ejs
public/
  js/
    thread/
      composer.js
      pane-splitter.js
      poll.js
data/
  disposable_email_blocklist.conf
  items.json
```

## Database SQL guides

For Supabase SQL setup and migration order, see:

- [src/db/sql/README.md](src/db/sql/README.md)
