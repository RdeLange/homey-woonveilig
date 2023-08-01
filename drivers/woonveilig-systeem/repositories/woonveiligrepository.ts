import { Device } from "homey";
import { WoonVeiligSettings } from "../models/woonveiligsettings";
import { WoonVeiligLog } from "../models/woonveiliglog";
import { setTimeout } from "timers/promises";
import { Agent } from "https";
const fetch = require('node-fetch-retry');
//const https = require('https');

class WoonVeiligRepository {
    private configuration: WoonVeiligSettings;
    private authorizationHeader: string;
    private listeners: { [eventType: string]: Device.CapabilityCallback[] } = {
        'state-changed': [],
        'alarm-changed': []
    };
    private agent: Agent;

    constructor(configuration: WoonVeiligSettings) {
        this.configuration = configuration;
        this.authorizationHeader = `Basic ${Buffer.from(this.configuration.username + ':' + this.configuration.password, 'binary').toString('base64')}`;
        this.agent = new Agent({ keepAlive: true });
    }

    async login(): Promise<boolean> {
        try {
            var request = this.getBasicRequestInit();
            request.method = 'post'
            var response = await fetch(this.getUrl('/action/login'), request, this.agent);
            return response.status == 200;    
        } catch (error) {
            console.log(error);
            return false;
        }
    }

    async setState(state: AlarmState) {
        for(var i = 0; i < 3; i++)
        {
            var request = this.getBasicRequestInit();
            request.method = 'post'
            request.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            request.body = this.getFormBody({
                'area': '1',
                'mode': state
            });
            var response = await fetch(this.getUrl('/action/panelCondPost'), request, this.agent);
            if(response.status == 200)
                break;

            console.log(response);
            await setTimeout(1000);
        }
    }

    async processLastLogs(lastLogDate: Date) : Promise<Date> {
        var request = this.getBasicRequestInit();
        request.method = 'post'
        request.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        request.body = this.getFormBody({
            'max_count': 20
        });
        var response = await fetch(this.getUrl('/action/logsGet'), request, this.agent);
        if(response.status != 200) {
            console.log(response);
            return lastLogDate;
        }

        var logRows = (await response.json()).logrows;
        // If there are no new logs
        if(logRows.length == 0)
            return lastLogDate;

        var logs : WoonVeiligLog[] = logRows.map((logRow: { action: string; area: string; device_type: string; log_time: string; mode: string; msg: string; source: string; user: string; }) => {
            var log = new WoonVeiligLog();
            log.action = logRow.action;
            log.area = logRow.area;
            log.device_type = logRow.device_type;
            log.log_time = new Date(logRow.log_time);
            log.mode = logRow.mode;
            log.msg = logRow.msg;
            log.source = logRow.source;
            log.user = logRow.user;
            return log;
        });
        
        var newLogs = logs.filter(log => log.log_time > lastLogDate);
        var modeChangedLogs = newLogs.filter(log => log.action == 'Mode Changed' && log.msg == 'Success');
        var modeDisarmedLogs = modeChangedLogs.filter(log => log.mode == 'Disarm');
        // First check is for the motion sensors, the seconds check is when the door is openened and you get some time to enter the pincode but don't do that in time
        var alarmChangedLogs = newLogs.filter(log => log.msg == 'Burglar Alarm' || (log.action == 'Timeout' && log.msg == 'Entry Timeout'));

        var alarmChangedValue: boolean | null = null;
        var stateChangedValue: AlarmState | null = null;

        // If the alarm went off, check if it was disarmed
        if(alarmChangedLogs.length > 0) {
            // If it was disarmed, the alarm is off now
            if(modeDisarmedLogs.length > 0 && modeDisarmedLogs[0].log_time > alarmChangedLogs[0].log_time) {
                alarmChangedValue = false;
            }
            // It was not disarmed, so alarm is on
            else {
                alarmChangedValue = true;
            }
        }
        // There are no Alarm logs, maybe the alarm is already on and there was a Disarm log. Then the alarm is off now
        else if(modeDisarmedLogs.length > 0) {
            alarmChangedValue = false;
        }

        // Now we simply set the latest state
        if(modeChangedLogs.length > 0) {
            switch(modeChangedLogs[0].mode) {
                case 'Full Arm':
                    stateChangedValue = AlarmState.Armed;
                    break;
                case 'Home Arm 1':
                case 'Home Arm 2':
                case 'Home Arm 3':
                    stateChangedValue = AlarmState.PartiallyArmed;
                    break;
                case 'Disarm':
                    stateChangedValue = AlarmState.Disarmed;
                    break;
            }
        }

        if(alarmChangedValue != null) {
            this.listeners['alarm-changed'].forEach(listeners => {
                listeners.call(null, alarmChangedValue, null);
            });
        }
        
        if(stateChangedValue != null) {
            this.listeners['state-changed'].forEach(listeners => {
                listeners.call(null, stateChangedValue, null);
            });
        }
        return logs[0].log_time;
    }

    on(eventType: string, listener: Device.CapabilityCallback): void {
        this.listeners[eventType].push(listener);
    }

    private getBasicRequestInit(): any {
        // Use a retry policy, because at random WoonVeilig returns a 401. This does not happen in the browser, so I added the exact same request headers as the browser trying to prevent any 401 error. Also, a user-agent is mandatory as the session seems to be linked to the user-agent
        return {
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Encoding': 'gzip, deflate',
                'Accept-Language': 'en-US,en;q=0.5',
                'Authorization': this.authorizationHeader,
                'Connection': 'keep-alive',
                'Origin': this.getUrl(''),
                'Referer': this.getUrl('/setting/log.htm'),
                'User-Agent': 'HomeyWoonVeilig/1.0.0',
                'X-Requested-With': 'XMLHttpRequest'
            },
            retry: 3,
            pause: 1000
        }
    }

    private getUrl(route: string) : string {
        return `http://${this.configuration.ipaddress + route}`;
    }

    private getFormBody(details : any) : string {
        var formBody = [];
        for (var property in details) {
            var encodedKey = encodeURIComponent(property);
            var encodedValue = encodeURIComponent(details[property]);
            formBody.push(encodedKey + "=" + encodedValue);
        }
        return formBody.join("&");
    }
}

enum AlarmState {
    Disarmed = 0,
    Armed = 1,
    PartiallyArmed = 2
}

export { WoonVeiligRepository, AlarmState };