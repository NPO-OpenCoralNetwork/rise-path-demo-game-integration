# 🤝 Contributing to Rise Path

Thank you for your interest in contributing to Rise Path! We welcome contributions of all kinds, including code, design, documentation, bug reports, and feedback.

Please take a moment to read this guide to ensure a smooth and productive collaboration.

---

## 🗺️ Project Navigation

Our visual roadmap and tasks are tracked using the following:
- **🎨 Miro (Roadmap & Design)**: [Miro Board](https://miro.com/...)
- **📋 GitHub Projects**: [Project Board #16](https://github.com/orgs/NPO-OpenCoralNetwork/projects/16)

---

## 🛠️ How to Contribute

### 1. Reporting Bugs
If you find a bug, please open a [GitHub Issue](issues) with:
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (Browser, OS, Node.js version)
- Screenshots or logs if applicable

### 2. Proposing Features
Have an idea for a new feature? Open an Issue to discuss it with the community before starting work.

### 3. Coding and Code Contributions
1. Select an existing Issue you want to work on.
   - For beginners, look for the **`good first issue`** or **`help wanted`** labels.
2. Leave a comment on the Issue saying "I'll take this" to prevent duplicated work.
3. Follow the Git workflow outlined below.

---

## 🚀 Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/NPO-OpenCoralNetwork/rise-path-demo-game-integration.git
   cd rise-path-demo-game-integration
   ```
2. **Setup Environment**:
   Create a `.env.local` file in the root directory:
   ```env
   # Local LLM (Hermes) Settings (Default)
   HERMES_API_URL=http://127.0.0.1:8642
   HERMES_API_KEY=change-me-local-dev
   ```
3. **Install & Run**:
   ```bash
   npm install
   npm run dev
   ```

---

## 🌿 Git Branching & Commit Rules

We maintain a clean and structured commit history.

### ① Branch Naming
Create a new branch from `main`. Use the following naming convention:
- New features: `feature/feature-name` (e.g., `feature/add-stage-3`)
- Bug fixes: `fix/fix-details` (e.g., `fix/compilation-error`)
- Documentation: `docs/doc-details` (e.g., `docs/update-readme`)
- Assets: `asset/asset-name` (e.g., `asset/slime-image`)

### ② Commit Messages
Prefix your commits with one of the following:
- `feat:` A new feature or logic
- `fix:` A bug fix or UI layout correction
- `docs:` Documentation changes only
- `asset:` Game images, BGM, or audio files
- `refactor:` Code cleanup without changing behavior

*Example:* `asset: replace slime image with clean transparent png`

---

## 📤 Pull Request (PR) Guidelines

1. **Before Submitting**:
   - [ ] Run `npm run build` locally to ensure no compilation errors.
   - [ ] Ensure no credentials or API keys are hardcoded in the codebase.
   - [ ] Confirm new assets meet file size compression and transparency guidelines.
2. **Submit PR**:
   - Link the PR to the relevant Issue (e.g., `Fixes #17`) to automatically close it on merge.
3. **Review & Merge**:
   - All PRs require at least one **Approve** from a maintainer or core contributor before merging into `main`.

---

## ⚖️ Code of Conduct
We are committed to providing a welcoming, harassment-free environment for everyone. We expect all contributors to communicate with respect, empathy, and professionalism.

If you have any questions, feel free to open an Issue or contact the community. We are excited to build with you!
