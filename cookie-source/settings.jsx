import React from 'react';
import {createRoot} from 'react-dom/client';
import CookiePopup from './CookiePopup.jsx';

export function mountSettings(container){
 const root=createRoot(container);
 return props=>root.render(<CookiePopup {...props}/>);
}
