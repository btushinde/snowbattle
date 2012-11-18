// Load external node.js modules
var express = require('express')
, http = require('http')
, WebSocketServer = require('websocket').server
, Buffer = require('buffer').Buffer;

// Express framework settings
var app = express();
app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.logger('dev'));
  app.use(express.static(__dirname + '/public'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
});
app.configure('development', function(){
  app.use(express.errorHandler());
});

// When visitors requests http://domain.com:portnumber/, then render views/index.ejs
app.get('/', function(req, res){
    res.render('index');
});

// Box2djs depends on jQuery.extend
// jQuery needs a window object to add certain functions to, a window which Node.js does not have.
// Solution: import just jQuery.extend
var jQuery = require('./public/javascripts/jquery-extend.js');
Object.extend = jQuery.extend; // this is the feature box2d needs
var b2 = require('./public/javascripts/box2d.js');

// Box2D world
var worldAABB = new b2.b2AABB();
worldAABB.minVertex.Set(-1000, -1000);
worldAABB.maxVertex.Set(1000, 1000);
var gravity = new b2.b2Vec2(0, 400);
var b2world = new b2.b2World(worldAABB, gravity, true);
var groundBody = b2world.GetBodyList();
for(var i=0; i<10; i++){
    var ballSd = new b2.b2BoxDef();
    ballSd.density = 1.0;
    ballSd.extents.Set(20,20);
    ballSd.restitution = 0.6;
    ballSd.friction = 0.4;
    var ballBd = new b2.b2BodyDef();
    ballBd.AddShape(ballSd);
    ballBd.position.Set(Math.random(),Math.random());
    ballBd.allowSleep = false;
    b2world.CreateBody(ballBd);
}

// Creates a static box2d box at x,y with size w,h
function createStaticBox(x,y,w,h){
    var groundSd = new b2.b2BoxDef();
    groundSd.extents.Set(w, h);
    groundSd.restitution = 0.5;
    groundSd.friction = 0.3;
    var groundBd = new b2.b2BodyDef();
    groundBd.AddShape(groundSd);
    groundBd.position.Set(x,y);
    return b2world.CreateBody(groundBd);
}

// World walls
var w = 640, h = 480;
var cw = 10;
var groundBody = createStaticBox(0,         h*0.5-cw, w*0.5, cw);
var topBody =    createStaticBox(0,        -h*0.5+cw, w*0.5, cw);
var leftBody =   createStaticBox(cw-w*0.5,  0,        cw,    h*0.5);
var rightBody =  createStaticBox(w*0.5-cw,  0,        cw,    h*0.5);

// Returns a concise description of the current world in json format
function world2json(world){
    var json = {bodies:[]};
    for(var b = world.GetBodyList(); b; b = b.GetNext()){
	for(var s = b.GetShapeList(); s != null; s = s.GetNext()){
	    switch(s.m_type){
	    case b2.b2Shape.e_circleShape:
		json.bodies.push({type:s.m_type, radius:s.m_radius});
		break;
	    case b2.b2Shape.e_boxShape:
		json.bodies.push({type:s.m_type, width:1, height:1});
		break;
	    case b2.b2Shape.e_polyShape:
		var verts = [];
		for(v in s.m_vertices){
		    verts.push(s.m_vertices[v].x);
		    verts.push(s.m_vertices[v].y);
		}
		json.bodies.push({type:s.m_type, vertices:verts});
		break;
	    default:
		throw new Error("Cannot recognize object "+s.m_type);
		break;
	    }
	}
    }
    return json;
}

// Simulation loop
setInterval(function(){
    b2world.Step(1/60,2,4);
}, 1.0/60.0 * 1000);

// Start Webserver
var server = http.createServer(app).listen(3000);
console.log("Express server listening on port 3000");

// Start the WebSocketServer
var wss = new WebSocketServer({httpServer: server});
wss.on('request', function(req){

    // Accept connection
    var connection = req.accept(null, req.origin);

    // Send world information
    connection.send(JSON.stringify(world2json(b2world)));

    // Each user has got an own mouseJoint to play with
    var mouseJoint;

    // Message
    connection.on('message', function(message) {
        switch(message.type){
	case 'utf8':
	    break;
	case 'binary':
	    // Move joint
	    var bin = message.binaryData;
	    var x = bin.readFloatLE(0),
	    y = bin.readFloatLE(4);
	    state = bin.readFloatLE(8);
	    switch(state){
	    case 0: // MouseUp - Remove mouseJoint
		if(mouseJoint){
		    b2world.DestroyJoint(mouseJoint);
		    mouseJoint = null;
		}
		break;
	    case 1: // MouseDown - Add mouseconstraint
		// First we must find the clicked body
		var clickedBody = null;
		for(var b = b2world.GetBodyList(); b; b = b.GetNext()){
		    for(var s = b.GetShapeList(); s != null; s = s.GetNext()){
			// Need to rotate the shape.
			var p = new b2.b2Vec2(x,y);
			if(s.TestPoint(p))
			    clickedBody = b;
		    }
		}
		if(clickedBody){
		    // Attach body to a mouse joint
		    var md = new b2.b2MouseJointDef();
		    md.bodyA = md.body1 = groundBody;
		    md.bodyB = md.body2 = clickedBody;
		    md.target.Set(x,y);
		    md.collideConnected = true;
		    md.dampingRatio = 0.0;
		    md.frequencyHz =  60.0;
		    md.maxForce = 100 * md.body2.GetMass() * b2world.m_gravity.Length();
		    var mj = b2world.CreateJoint(md);
		    mouseJoint = mj;
		}
		break;
	    case 2: // MouseMove - Move the attachment point
		if(mouseJoint)
		    mouseJoint.m_target.Set(x,y);
		break;
            }
	}
    });

    // Send body positions to the client at 60Hz
    var interval = setInterval(function(){
	var bodies = [];
	for(var b = b2world.GetBodyList(); b; b = b.GetNext()){
	    if(b.m_shapeCount)
		bodies.push(b);	    
	}
	var buf = new Buffer(3*4*bodies.length); // (x,y,angle) * (4 bytes per number) * numBodies
	for(var i=0; i<bodies.length; i++){
	    // Send body data
	    var b = bodies[i];
	    buf.writeFloatLE(b.m_position.x, 3*4*i + 0);
	    buf.writeFloatLE(b.m_position.y, 3*4*i + 4);
	    buf.writeFloatLE(b.GetRotation() % (Math.PI*2), 3*4*i + 8);
	}
	connection.send(buf);
    }, 1.0/60.0 * 1000);

    // Close
    connection.on('close', function(connection) {
	clearInterval(interval); // Stop the sending loop
    });
});
