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
           // var request = this.getBasicRequestInit();
           // request.method = 'post'
           // var response = await fetch(this.getUrl('/action/login'), request, this.agent);
           // return response.status == 200; 
            return true;
        } catch (error) {
            console.log(error);
            return false;
        }
    }

    async setState(state: AlarmState) {
        var repeat = 3;
        for(var i = 0; i < 3; i++)
        {
         if (state == 1) {state = 0}
            else if (state == 0) {state =2}
            else if (state == 2) {state =1}
            console.log("setState to:",state)
            var request = this.getBasicRequestInit();
            request.method = 'post'
            request.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
            request.body = this.getFormBody({
                //'area': '1',
                'mode': state
            });
            do {
                console.log("check1")
                var response = await this.fetchPlus('/action/panelCondPost',request,this.agent) 
                    console.log(response)
                if (response == true) {
                    console.log("setState Successful")
                    repeat = 0;
                }
                if (response == false) {
                    console.log("setState not succesful, will try "+[(repeat-1).toString]+" times")
                    repeat = repeat -1
                    setTimeout(3000);
                }
              }
              while (repeat > 0); 
            break;

            //var feedback = await response.text();
            //if(response.status == 200 && feedback.included("status: 1"))
            //    console.log(await response.text());
            
        }
    }

   async fetchPlus(url:string,req:string,agent:Agent) {
    console.log("Check2")
    var response= await fetch(this.getUrl(url), req, agent);
    var feedback = await response.text();
            console.log("responsetext:",feedback)
            if(response.status == 200 && feedback.includes("result : 1")){
                return true;}
            else {
                return false;
            }
            
   }
    

    async processLastLogs(lastLogDate: Date) : Promise<Date> {
        var request = this.getBasicRequestInit();
        request.method = 'get'
        request.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        //request.body = this.getFormBody({
        //    'max_count': 20
        //});
       
        var response = await fetch(this.getUrl('/action/historyGet'), request, this.agent);
        
        if(response.status != 200) {
            return lastLogDate;
        }

        var logRowstemp = await response.text();
        //console.log(logRowstemp)
        var logRows = this.processcrappyjson(logRowstemp).hisrows

        // If there are no new logs
        if(logRows.length == 0)
            return lastLogDate;

        
        var logs : WoonVeiligLog[] = logRows.map((logRow: { d: string; t: string; s: string; a: string;}) => {
            var log = new WoonVeiligLog();
            log.action = this.defineAction(logRow.a);
            log.area = "1";
            log.device_type = logRow.a;
            log.log_time = new Date(this.reformattime(logRow.d,logRow.t));
            log.mode = logRow.a;
            log.msg = this.defineMsg(logRow.a);
            log.source = logRow.s;
            log.user = "admin";
            return log;
        });
        //console.log(logs)
        
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
            if(modeDisarmedLogs.length > 0 && modeDisarmedLogs[modeDisarmedLogs.length-1].log_time > alarmChangedLogs[alarmChangedLogs.length-1].log_time) {
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
        //console.log(modeChangedLogs)
        if(modeChangedLogs.length > 0) {
            //console.log("State",modeChangedLogs[modeChangedLogs.length-1].mode)
            switch(modeChangedLogs[modeChangedLogs.length-1].mode) {
                case 'Arm':
                    stateChangedValue = AlarmState.Armed;
                    break;
                case 'Home':
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

    private replaceAll(str:string, find:string, replace:string) {
        return str.replace(new RegExp(find, 'g'), replace);
      }

    private processcrappyjson(input:string)  {
        //console.log(input)
        var prm_jsonData = input.replace("/*-secure-","")
        prm_jsonData = prm_jsonData.replace("*/","")
        prm_jsonData = prm_jsonData.replace('{	hisrows : [','{"hisrows":[')
        prm_jsonData = prm_jsonData.replace(/ {4}|[\t\n\r]/gm,'')
        var property_names_to_fix = ["d","t","a","s"]
        for (let i = 0; i < property_names_to_fix.length; i++) {
            prm_jsonData = this.replaceAll(prm_jsonData,property_names_to_fix[i]+' :','"'+property_names_to_fix[i]+'":')
        }     
        var output = JSON.parse(prm_jsonData);
        return output;
    }

    private reformattime(date:string,time:string) {
        var newdate = date.replace("/","-")
        var newtime = time+":00";
        const d = new Date();
        let year = d.getFullYear();
        return year+"-"+newdate+"T"+newtime
    }

    private defineAction(action:string){
        var output = "unknown";
        if (action == "Arm" || "Disarm" || "Home") {
            output = "Mode Changed"
        }
        return output;
    }

    private defineMsg(action:string){
        var output = "Success";
        if (action.includes("Burglary")  ) {
            output = "Burglar Alarm"
        }
        return output;
    }
}

enum AlarmState {
    Disarmed = 0,
    Armed = 1,
    PartiallyArmed = 2
}

export { WoonVeiligRepository, AlarmState };