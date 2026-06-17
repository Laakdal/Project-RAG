### 🟢 Core RAG — the actual product

| Feature | Route | What it does |
|---|---|---|
| **Chat** | `/chat` | The RAG conversation UI — ask questions, get streamed answers (SSE) with citations back to your documents. Conversation history in the sidebar. |
| **Collections / Knowledge Base** | `/knowledge-base` | Upload & organize documents into collections/folders. "All Records" browses everything across sources. This is what feeds the RAG. |
| **Record viewer** | `/record` | Opens a single document with PDF highlighting/preview — where citation deep-links land. |

### 🟡 AI extras — powerful, but optional for a basic RAG

| Feature | Route | What it does |
|---|---|---|
| **Connectors** | `/connectors` | Connect external sources (Google Drive). [imo lets say i build this for company, they use many database, like sql server, oracle and others, so this will be useful for them]

### 🔵 Auth & account

| Feature | Route | What it does |
|---|---|---|
| **Auth flows** | `/login` | Sign-in via password | [For login, since this is for internal use only it'll be better if there's create account in admin panel, and user can only login if they have an account. No sign up, no reset password, no forgot password. so the admin there can manage it for employees]

### 🟠 Workspace / admin  (`/workspace/*`)

- `users`, `teams` — user management / RBAC [idk maybe for long term it'll be useful]
- `general`, `profile` — org & user settings [simple one]



## 2. The honest caveat

These features are **interconnected**, so "simplify" = real refactoring, not just deleting folders:

- The **sidebar** links to all these routes — removing a page means fixing nav.
- **Chat** may depend on model/agent selection; **Collections** feed Chat.
- The **onboarding gate** in `app/(main)/layout.tsx` redirects to `/onboarding` based on a backend call.
- Shared **Zustand stores** and the **API layer** are referenced across pages.

So the work is done **in phases**, lowest-risk first, verifying the app still boots after each phase.



im going to use n8n