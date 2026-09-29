// Generated smoke test for robofly_core.
`timescale 1ns/1ps
module robofly_core_tb;
    localparam int N = 256;
    localparam int MOTOR_COUNT = 12;
    logic clk = 0;
    logic rst = 1;
    logic tick = 0;
    logic signed [15:0] drive [N];
    logic done;
    logic [N-1:0] spikes;
    logic signed [31:0] motor_accum [MOTOR_COUNT];
    logic [31:0] cycle_count;

    robofly_core dut(.clk(clk), .rst(rst), .tick(tick), .drive(drive), .done(done), .spikes(spikes), .motor_accum(motor_accum), .cycle_count(cycle_count));

    always #5 clk = ~clk;

    initial begin
        $dumpfile("tb/robofly_core_tb.vcd");
        $dumpvars(0, robofly_core_tb);
        for (int i = 0; i < N; i++) drive[i] = 16'sd0;
        #20 rst = 0;
        for (int j = 88; j < 96; j++) drive[j] = 16'sd512;
        repeat (5) begin
            tick = 1;
            #10 tick = 0;
            #10;
        end
        #50;
        $display("done=%0d cycles=%0d escape=%0d", done, cycle_count, motor_accum[5]);
        $finish;
    end
endmodule
