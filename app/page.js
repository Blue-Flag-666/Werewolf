"use client";
import React from "react";
import {FluentProvider, webLightTheme} from "@fluentui/react-components";

import App from "./app";

export default function index() {
    return (<FluentProvider theme={webLightTheme}>
        <App/>
    </FluentProvider>);
}
