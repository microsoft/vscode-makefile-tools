import * as vscode from 'vscode';
import * as util from '../util';
import { getCurPID } from '../make';

abstract class CommandConsumer {
    output(line: string): void {
        this._stdout.push(line);
    }
    error(error: string): void {
        this._stderr.push(error);
    }
    get stdout() {
        return this._stdout.join('\n');
    }
    protected readonly _stdout = new Array<string>();

    get stderr() {
        return this._stderr.join('\n');
    }
    protected readonly _stderr = new Array<string>();
}

const endOfLine: string = "\r\n";

export class CustomBuildTaskTerminal extends CommandConsumer implements vscode.Pseudoterminal {

  constructor(private command: string, private args: string[], private cwd: string, private env?: { [key: string]: string }) {
    super();
  }

  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number>();
  public get onDidWrite(): vscode.Event<string> {
      return this.writeEmitter.event;
  }
  public get onDidClose(): vscode.Event<number> {
      return this.closeEmitter.event;
  }

  override output(line: string): void {
      this.writeEmitter.fire(line + endOfLine);
      super.output(line);
  }

  override error(error: string): void {
      this.writeEmitter.fire(error + endOfLine);
      super.error(error);
  }

  private _process: util.SpawnProcess | undefined; 
  async open(_initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
    this._process = util.spawnChildProcess(
      this.command,
      this.args,
      {
        workingDirectory: this.cwd,
        stdoutCallback: (line: string) => this.output(line),
        stderrCallback: (error: string) => this.error(error),
        env: this.env
      }
    )
    const res: util.SpawnProcessResult = await this._process.result;
    this.closeEmitter.fire(res.returnCode);
  }
  async close(): Promise<void> {
    if (this._process) {
        if (this._process.child) {
            await util.killTree(getCurPID());
        }
        this._process = undefined;
    }
  }
  
}