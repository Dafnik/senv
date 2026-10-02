FROM node:24-alpine

WORKDIR /app

COPY package.json /tmp/workspace-package.json

RUN DRIZZLE_KIT_VERSION=$(node -p "require('/tmp/workspace-package.json').devDependencies['drizzle-kit']") && \
    DRIZZLE_ORM_VERSION=$(node -p "require('/tmp/workspace-package.json').dependencies['drizzle-orm']") && \
    SQLITE_VERSION=$(node -p "require('/tmp/workspace-package.json').dependencies['better-sqlite3']") && \
    DOTENV_VERSION=$(node -p "require('/tmp/workspace-package.json').devDependencies.dotenv") && \
    npm install --ignore-scripts --save-exact "drizzle-kit@$DRIZZLE_KIT_VERSION" "drizzle-orm@$DRIZZLE_ORM_VERSION" "better-sqlite3@$SQLITE_VERSION" "dotenv@$DOTENV_VERSION" && \
    rm /tmp/workspace-package.json

COPY drizzle.config.ts ./
COPY drizzle ./drizzle

CMD ["./node_modules/.bin/drizzle-kit", "migrate"]
