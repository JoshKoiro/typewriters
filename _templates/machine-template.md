---
# Field reference: README.md > "Machine fields". Leave unknown fields blank; blanks are hidden.
title: ""                 # year + make + model, e.g. "1965 Brother Valiant"
nickname: ""
make: ""
model: ""
year:                     # a number, e.g. 1965
year_approx: false        # true if the year is an estimate (shows "c. 1965")
serial: ""
made_in: ""
color: ""

# Specs
typeface: ""              # e.g. "Pica", "Elite", "#84 Bodoni Elite" (quote anything with #)
pitch:                    # characters per inch, e.g. 10 or 12
size_class: ""            # ultra-portable | portable | semi-portable | standard
keyboard: "QWERTY"
carriage_width:           # inches of paper it takes, e.g. 9
spools: ""                # ribbon spool type, e.g. "universal 2-inch"
features: []              # e.g. [tabulator, touch control, paper support, two-color ribbon]
weight: ""                # e.g. "8.5 lb"

# Condition
parts_only: false         # true if it's only good for parts (shows a "Parts only" badge)
has_case: false           # true | false
typing_feel:              # 1 to 5
favorite: false

# Ownership
status: collection        # collection | for-sale | sold | sighting
acquired:                 # date as YYYY-MM-DD, e.g. 2026-10-11 (no quotes)
acquired_approx: false    # true if you only know the month (use the 1st)
purchased_from: ""        # e.g. "Antique Store", "Facebook Marketplace"
sold_date:                # YYYY-MM-DD, once it's sold
price: ""                 # asking price, shown while status is for-sale
listing_url: ""

# Links and display
twdb_url: ""
tags: []
cover: ""                 # shot to use as the gallery cover, e.g. front (default: thumbnail)

# Issues: problems with the machine. Listed on the page; click one to see its repair timeline.
# See README.md > "Issues and repairs". Run npm run check:issues to catch typos.
issues: []
#  - id: feed-rollers            # short, lowercase-with-hyphens; repairs point at this
#    title: "Paper not advancing: flat-spotted feed rollers"
#    category: paper-feed        # see issue_category in _data/fields.yml
#    status: open                # open | managed | fixed
#    opened: 2026-11-03
#    description: >-
#      What's wrong and how it shows up.
#    resolved:                   # date, once it's managed or fixed
#    resolution: >-
#      How it was fixed, or why you're living with it.
#    related: []                 # other issue ids on this machine

# Repair log: one entry per job, in any order (the page sorts newest first).
repairs: []
#  - date: 2026-11-03
#    issue: feed-rollers         # optional: which issue this job was for (leave out for ad-hoc work)
#    outcome: partial            # optional: fixed | partial | no-help
#    work: >-
#      Replaced the feed rollers with silicone tubing.
#      Can run over several lines.
---

## Notes

How it types, its history, quirks, anything worth remembering.
