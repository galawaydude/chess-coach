import { mount } from 'svelte'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import './app.css'
import App from './App.svelte'

export default mount(App, { target: document.getElementById('app')! })

if (Capacitor.isNativePlatform()) {
  NativeApp.addListener('backButton', ({ canGoBack }) => {
    const home = location.hash === '' || location.hash === '#/' || location.hash === '#/games'
    if (canGoBack && !home) history.back()
    else NativeApp.exitApp()
  })
}
