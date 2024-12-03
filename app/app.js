import Configure from "@/app/pages/Configure";

const STATUS = {
    CONFIGURE: 0, ASSIGN: 1, CHECK: 2
};

let status = STATUS.CONFIGURE;

export default function app() {
    switch (status) {
        case STATUS.CONFIGURE: {
            return <Configure/>;
        }
        case STATUS.ASSIGN: {
            return;
        }
        case STATUS.CHECK: {
            return;
        }
    }
}