import React from "react";
import {Button, Divider, Label, SpinButton} from "@fluentui/react-components";
import {Space, Style, Title} from "@/app/widgets";
import {core} from "@/app/core";

function Character({name, defaultNumber, camp}) {
    defaultNumber = defaultNumber === undefined ? 0 : defaultNumber;

    const labelStyle = Style({display: "inline-block", minWidth: "75px"});
    const spinButtonStyle = Style({marginLeft: "15px", width: "75px"});

    const [value, setValue] = React.useState(defaultNumber);

    const onChange = React.useCallback((_, data) => {
        if (data.value !== undefined) {
            setValue(data.value);

            if (camp === core.CAMP.COMMONER) {
                core.commoner = data.value;
            } else if (camp === core.CAMP.GOOD) {
                core.goodCamp.set(name, data.value);
            } else if (camp === core.CAMP.WEREWOLF) {
                core.werewolf.set(name, data.value);
            } else if (camp === core.CAMP.THIRD) {
                core.thirdCamp.set(name, data.value);
            }
        }
    }, [camp, name]);

    return (<div>
        <Label className={labelStyle}>{name}</Label>
        <Label>
            <SpinButton className={spinButtonStyle} name={name} value={value} min={0} onChange={onChange}/>
        </Label>
    </div>);
}

export default function Configure() {
    const goodCamp = [];
    goodCamp.push(<Character key="平民" name="平民" defaultNumber={core.commoner} camp={core.CAMP.COMMONER}/>);
    core.goodCamp.forEach((value, key) => {
        goodCamp.push(<Character key={key} name={key} defaultNumber={value} camp={core.CAMP.GOOD}/>);
    });

    const werewolf = [];
    core.werewolf.forEach((value, key) => {
        werewolf.push(<Character key={key} name={key} defaultNumber={value} camp={core.CAMP.WEREWOLF}/>);
    });

    const thirdCamp = [];
    core.thirdCamp.forEach((value, key) => {
        thirdCamp.push(<Character key={key} name={key} defaultNumber={value} camp={core.CAMP.THIRD}/>);
    });

    const style = Style({display: "grid", margin: "auto"});

    const confirm = () => {
        console.log(core.commoner);
        console.log(core.goodCamp);
        console.log(core.werewolf);
        console.log(core.thirdCamp);
        //todo
    }

    return (<>
        <Title center text="好人阵营"/>
        {goodCamp}
        <Divider appearance={"subtle"}/>
        <Title center text="狼人阵营"/>
        {werewolf}
        <Divider appearance={"subtle"}/>
        <Title center text="第三阵营"/>
        {thirdCamp}
        <Divider appearance={"subtle"}/>
        <Space height="10px"/>
        <Button className={style} appearance={"primary"} onClick={confirm}>确定</Button>
    </>);
}