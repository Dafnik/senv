---
status: accepted
---

# Retire old preview addresses when a project slug changes

Preview addresses use a separate readable, editable project slug rather than the project's immutable ID or its existing internal organization slug. Changing that slug moves deployment and alias addresses to the new namespace, retires the old addresses immediately, and permits another project to claim the old slug. This gives admins reusable readable names without maintaining old aliases, at the cost of breaking existing links and allowing a previously shared address to point to a different project after reuse.
