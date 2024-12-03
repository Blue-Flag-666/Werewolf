import {makeStyles} from "@fluentui/react-components";

export function Title({center, text}) {
    return center ? <h1 align={"center"} className="title">{text}</h1> : <h1 className="title">{text}</h1>;
}

export function Space({height}) {
    const style = Style({height: height});
    return <div className={style}/>;
}

export function Style(style) {
    return makeStyles({style})().style;
}