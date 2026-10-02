# ui-helm

Local spartan/ui Helm components used by the Angular app. The app supplies this source package's runtime peer dependencies so Angular build, test, and dev-server bundles resolve them consistently. Import individual components through `@spartan-ng/helm/<component>`.

Vite Plus lints this package. The app owns the Prettier configuration and formats these Angular templates and TypeScript through `vp run fmt:angular` from the repository root.
