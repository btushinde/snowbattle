$(document).ready(function (){

    // The drawing canvas
    var r = Raphael("holder");

    // Screen dimensions
    var canvasWidth = 810;
    var canvasHeight = 480;

    var dt = 1/60; // framerate

    // World-to-screen transformation info
    var scale = 1, // No zooming
    offset_x = canvasWidth/2, // Translates world origin to canvas center
    offset_y = canvasHeight/2;

    // Define stuff
    var renderables = [];
    var upStats = new TimeStats(100), // last 100 steps
    downStats = new TimeStats(100);

    // Mouse drag things
    var last = 0; // Time when the mouse position was last sent
    var lastx = 0, lasty = 0;
    var mousedown = false;

    // Websocket stuff
    ws = new WebSocket("ws://localhost:3000");
    var send_buf = new ArrayBuffer(4*3); // x,y,mouseState
    var send_array = new Float32Array(send_buf);

    function send(x,y,state){
		send_array[0] = x;
		send_array[1] = y;
		send_array[2] = state;
		ws.send(send_buf);
		upStats.accumulate(send_buf.byteLength);
    }


    // Transforms a mouse position relative to an object, scales and puts offset on coords
    function transformMousePos(mouseEvent,relObject){
		// Get relative mouse position
		var x = mouseEvent.pageX-$(relObject).offset().left;
		var y = mouseEvent.pageY-$(relObject).offset().top;
		// Scale and translate
		x -= offset_x;
		y -= offset_y;
		x /= scale;
		y /= scale;
		return [x,y];
    }




    //// WebSocket callbacks //////////
    ws.onopen = function(){
		$("#stats").html("Connected");
    };

    ws.onmessage = function (e) {

    	if(e.data.possibly_sensitive_editable) console.log(e.data);

		if(e.data && e.data instanceof Blob){
		    // Update transforms. Need a filereader to read the fetched binary blob
		    var fr = new FileReader();
		    fr.onload = function(f){
				downStats.accumulate(fr.result.byteLength);
				var a = new Float32Array(fr.result);
				for(var i=0; i<a.length/3; i++){
				    renderables[i].el.transform(
					"t"+
					    (scale*a[i*3+0]+offset_x)+
					    ","+
					    (scale*a[i*3+1]+offset_y)+
					    "r"+(a[i*3+2]/Math.PI*180));
				}
		    }
		    fr.readAsArrayBuffer(e.data);

		} else if(typeof e.data == "string"){
		    // We got a world description in JSON. Parse it.
		    var world = JSON.parse(e.data);
		    if(world.bodies===undefined)
			throw new Error("Malformed data from server :(");

		    // Update world rendering objects
		    for(var i=0; i<world.bodies.length; i++){
				var b = world.bodies[i];

				switch(b.type){
					case 0: // circleshape
					    renderables.push({type:0,
							      el:r.circle(0, 0, b.radius)});
					    break;

					case 1: // boxshape
					    renderables.push({type:1,
							      el:r.rect(0, 0, b.width, b.height)});
					    break;


					case 2: // polyshape
					    // Create an SVG path string to draw the path, e.g. "M100 100L200 200"
					    // see the SVG path spec: http://www.w3.org/TR/SVG/paths.html
					    var path = "";

					    for(var j=0; j<b.vertices.length; j+=2){
							if(j===0) // first - move to start vertex
							    path += "M"+b.vertices[j]+" "+b.vertices[j+1];
							else // second and rest
							    path += "L"+b.vertices[j]+" "+b.vertices[j+1];
							if(j===b.vertices.length-2) // last - line to first again
							    path += "L"+b.vertices[0]+" "+b.vertices[1];
					    }

					    var p = r.path(path);
					    renderables.push({type:2,el:p});
					    break;

					default:
					    throw new Error("Cannot render shape of type "+b.type+"!");
				}
		    }
		    // Put some color on the renderable objects
		    for(ri in renderables)
				renderables[ri].el.attr({stroke: "#FD0752", "stroke-width": 1,fill:"#FD0752"});
		}
    };

    // Update stats loop
    var updateStats = setInterval(function(){
		var round = function(num,dec){
		    var pow = Math.pow(10,dec);
		    return Math.round(num*pow)/pow;
		}
		var now = new Date().getTime();
		$("#stats").html(round(downStats.average(now-1000),2)+" kb/s down, "+ round(upStats.average(now-1000),2)+" kb/s up");
    },1000);

    ws.onclose = function(){
		clearInterval(updateStats);
		$("#stats").html("Disconnected. Refresh page to try again.");
    };
});



function TimeStats(historyMax){
    var histmax = historyMax || 100;
    var vals = [],
    times = [];

    function time(){
		return (new Date()).getTime();
    }

    function deleteOverflow(){
		while(vals.length > histmax){
		    vals.shift();
		    times.shift();
		}
    }

    // Add a value
    this.accumulate = function(val){
		times.push(time());
		vals.push(val);
		deleteOverflow();
    };

    // Returns an average over a time span, "since" is a timestamp in millisec
    this.average = function(since){
		var total = 0.0, n = 0, first = null, last = null;

		for(var i=0; i<vals.length; i++){
		    if(since==undefined || times[i]>since){
			total += vals[i];
			n++;
			if(first===null || times[i]<first)
			    first = times[i];
			if(last===null || times[i]>last)
			    last = times[i];
		    }
		}

		if(!first || !last || first===last)
		    return 0.0;
		return total / (last-first);
    };
};


function addObject(){
	ws.send( "" );
}


// Given a string, returns an array of hashtags
String.prototype.parseHashtags = function() {
	//var t = this.replace(/[#]+[A-Za-z0-9-_]+/g);
	var ret = [];
	$(this.split(' ')).each(function(k,v){
		if(v.charAt(0) == "#") ret.push(v.replace('#',''));
	});
	return ret;
};