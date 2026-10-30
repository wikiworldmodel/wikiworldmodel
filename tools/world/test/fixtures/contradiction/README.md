# Contradiction fixture

A deliberately inconsistent world: a fossil said to lie below (so to be older than) a lava
flow is dated younger than the flow. `npm run validate -- --world <this directory>` must
fail, and name exactly the three constraints that cannot all hold: the flow's start date,
the fossil's date, and the "before" relation between them. The second fossil is consistent
and must not be named.
