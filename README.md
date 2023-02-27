# @wharfkit/transact-plugin-autocorrect

A plugin to correct common issues users experience while performing transactions.

## Usage

Install plugin.

```
yarn add @wharfkit/transact-plugin-autocorrect
```

Include when configuring the Session Kit:

```ts
import {TransactPluginAutoCorrect} from '@wharfkit/transact-plugin-autocorrect'

const kit = new SessionKit({
    // ... your other options
    transactPlugins: [new TransactPluginAutoCorrect()],
})
```

Or when you are manually configuring a Session:

```ts
import {TransactPluginAutoCorrect} from '@wharfkit/transact-plugin-autocorrect'

const session = new Session({
    // ... your other options
    transactPlugins: [new TransactPluginAutoCorrect()],
})
```

## Developing

You need [Make](https://www.gnu.org/software/make/), [node.js](https://nodejs.org/en/) and [yarn](https://classic.yarnpkg.com/en/docs/install) installed.

Clone the repository and run `make` to checkout all dependencies and build the project. See the [Makefile](./Makefile) for other useful targets. Before submitting a pull request make sure to run `make lint`.

---

Made with ☕️ & ❤️ by [Greymass](https://greymass.com), if you find this useful please consider [supporting us](https://greymass.com/support-us).
