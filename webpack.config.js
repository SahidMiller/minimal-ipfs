const merge = require('../../configs/webpack')

const webpack = require('webpack')
const RemovePlugin = require('remove-files-webpack-plugin')
const path = require('path')

const output = path.join(__dirname, './dist')
const { ModuleFederationPlugin } = webpack.container;

module.exports = merge(webpack, {
    name: 'libp2p',
    entry: {
        libp2p:  path.join(__dirname, './src/index.js'),
    },
    output: { 
        path: output,
        filename: "[name].js",
        library: "Libp2p",
        libraryTarget: "umd",
    },
    plugins: [
        //http://localhost:3002/remoteEntry.js
        new ModuleFederationPlugin({
            name: "libp2p",
            filename: "remoteEntry.js",
            library: { type: "var", name: "Libp2p" },
            exposes: {
                "./Peer": path.join(__dirname, "./src/index.js")
            }
        }),
        new RemovePlugin({
            before: {
                include: [output],
                log: false,
                logWarning: true,
                logError: true,
                logDebug: false
            },
            watch: {
                beforeForFirstBuild: true
            }
        })
    ]
}, { 
    port: 55558, 
    static: output 
})