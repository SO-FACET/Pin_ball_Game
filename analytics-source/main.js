import {installAnalytics} from './runtime.js';
import {providerLoaders} from './provider-loaders.js';

installAnalytics(window,providerLoaders(window));
